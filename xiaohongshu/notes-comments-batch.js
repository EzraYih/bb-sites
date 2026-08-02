/* @meta
{  "name": "xiaohongshu/notes-comments-batch",
  "description": "Batch fetch note details with first-page comments and optional pagination",
  "domain": "www.xiaohongshu.com",
  "args": {
    "notes": {"required": true, "description": "JSON array of {noteId, xsecToken, xsecSource}"},
    "single_note_timeout_ms": {"required": false, "default": 12000},
    "max_failures": {"required": false, "default": 3},
    "min_delay_ms": {"required": false, "default": 5000},
    "max_delay_ms": {"required": false, "default": 8000},
    "external_min_delay_ms": {"required": false},
    "external_max_delay_ms": {"required": false},
    "max_comment_pages": {"required": false, "default": 3}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/notes-comments-batch --notes '[{\"noteId\":\"abc123\",\"xsecToken\":\"token123\"}]'"
}
*/

async function(args) {
  if (!args.notes) return { error: "Missing argument: notes" };

  // ── 复用 notes-batch.js 的 helper 初始化 ──
  const helper = globalThis.__bbBrowserXhsHelper?.findNoteInDetailMap
    ? globalThis.__bbBrowserXhsHelper
    : (globalThis.__bbBrowserXhsHelper = (() => {
    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
    function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
    function getGlobals() { return getApp()?.config?.globalProperties || null; }
    function getPinia() { return getGlobals()?.$pinia || null; }
    function getRouter() { return getGlobals()?.$router || null; }
    function getStore(name) { return getPinia()?._s?.get(name) || null; }
    function toPlain(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value ?? null; } }
    async function waitFor(predicate, timeoutMs, intervalMs) {
      if (intervalMs === undefined) intervalMs = 250;
      var deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try { var result = await predicate(); if (result) return result; } catch(e) {}
        await sleep(intervalMs);
      }
      return null;
    }
    function withTimeout(promise, timeoutMs, message) {
      return Promise.race([
        promise,
        sleep(timeoutMs).then(() => { throw new Error(message); })
      ]);
    }
    function buildNoteUrl(noteId, token, xsecSource) {
      if (!noteId) return null;
      if (!token) return "https://www.xiaohongshu.com/explore/" + noteId;
      var source = xsecSource || "pc_search";
      return "https://www.xiaohongshu.com/explore/" + noteId + "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=" + encodeURIComponent(source);
    }
    function normalizeUser(user) {
      if (!user || typeof user !== "object") return null;
      var nickname = user.nickname ?? user.name ?? user.nickName ?? null;
      var userId = user.userId ?? user.user_id ?? user.userid ?? user.id ?? null;
      var redId = user.redId ?? user.red_id ?? user.redid ?? null;
      var avatar = user.avatar ?? user.avatarUrl ?? null;
      if (!nickname && !userId && !redId) return null;
      return {
        nickname: nickname,
        red_id: redId,
        userid: userId,
        avatar: avatar,
        url: userId ? "https://www.xiaohongshu.com/user/profile/" + userId : null
      };
    }
    function collectNoteDetailMap() {
      var noteStore = getStore("note");
      if (!noteStore) return {};
      var map = noteStore.noteDetailMap || noteStore.note_detail_map || noteStore.detail || {};
      return map;
    }
    function findNoteInDetailMap(noteId) {
      var map = collectNoteDetailMap();
      if (typeof map.get === "function") return map.get(noteId);
      if (map[noteId]) return map[noteId];
      for (var key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        var value = map[key];
        if (value && (value.noteId === noteId || value.note_id === noteId)) return value;
      }
      return null;
    }
    return {
      sleep: sleep, getApp: getApp, getGlobals: getGlobals, getPinia: getPinia,
      getRouter: getRouter, getStore: getStore, toPlain: toPlain, waitFor: waitFor,
      withTimeout: withTimeout, buildNoteUrl: buildNoteUrl, normalizeUser: normalizeUser,
      collectNoteDetailMap: collectNoteDetailMap, findNoteInDetailMap: findNoteInDetailMap
    };
  })());

  // ── 解析 notes 参数 ──
  var notes;
  try {
    notes = typeof args.notes === "string" ? JSON.parse(args.notes) : args.notes;
  } catch {
    return { error: "Invalid notes argument, must be a JSON array" };
  }
  if (!Array.isArray(notes) || notes.length === 0) {
    return { error: "No valid notes provided", hint: "Provide a JSON array of {noteId, xsecToken} objects" };
  }

  // ── 配置 ──
  var singleNoteTimeoutMs = Number(args.single_note_timeout_ms) || Number(args.singleNoteTimeoutMs) || 12000;
  var maxFailures = Number(args.max_failures) || 3;
  var minDelayMs = Number(args.external_min_delay_ms) || Number(args.min_delay_ms) || 5000;
  var maxDelayMs = Number(args.external_max_delay_ms) || Number(args.max_delay_ms) || 8000;
  var maxCommentPages = Number(args.max_comment_pages) || 3;
  var baseDelayMs = minDelayMs;

  // ── SPA 就绪等待 ──
  var appReady = await helper.waitFor(function() { return helper.getApp(); }, 8000, 250);
  if (!appReady) {
    return {
      error: "Vue app not found",
      hint: "SPA became unavailable during batch execution",
      stopped_reason: "spa_not_ready"
    };
  }

  var router = helper.getRouter();
  if (!router) return { error: "Router not available: page not fully loaded" };

  var collected = [], failures = [], remaining = [];
  var consecutiveFailures = 0;
  var totalElapsed = 0;

  var metrics = {
    totalNotes: notes.length,
    successCount: 0,
    failureCount: 0,
    avgElapsedMs: 0,
    maxElapsedMs: 0,
    slowNotes: 0,
    totalCommentCount: 0
  };

  for (var i = 0; i < notes.length; i++) {
    // ── 300013/300017 平台限流预检 ──
    try {
      var bodyText = document.body?.innerText || "";
      if (/300013|300017|安全限制|访问链接异常/.test(bodyText)) {
        var refNoteId = notes[i].noteId || notes[i].note_id || "unknown";
        failures.push({ note_id: refNoteId, error: "[300013/300017] platform limit", elapsed_ms: 0 });
        metrics.failureCount++;
        remaining = notes.slice(i);
        return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "consecutive_failures", hint: "platform limit (300013/300017) detected" };
      }
    } catch(e) {}

    var note = notes[i];
    var noteId = note.noteId || note.note_id;
    var xsecToken = note.xsecToken || note.xsec_token || "";
    var xsecSource = note.xsecSource || note.xsec_source || "pc_search";
    var error = null;
    var detail = null;
    var apiTimedOut = false;
    var noteStartTime = Date.now();
    var elapsed = 0;
    var tNav = 0, tApi = 0, tDetail = 0, tComment = 0, tPagination = 0;
    var commentsTimeout = false;
    var commentsDebug = null;

    try {
      // ── 1. router.push(/explore/{noteId}) ──
      router.push({
        path: "/explore/" + noteId,
        query: {
          xsec_token: xsecToken || "",
          xsec_source: xsecSource || "pc_search",
          source: "web_explore_feed"
        }
      }).catch(function() {});

      try {
        console.log(JSON.stringify({__bb_progress: {
          done: i, total: notes.length, noteId: noteId, success: null, error: null,
          stage: "router_pushed", currentUrl: String(location.href || "")
        }}));
      } catch(e) {}

      await helper.sleep(1800);

      // ── 2. 300031 早期检测 ──
      try {
        var navUrl = String(location.href || "");
        if (navUrl.indexOf("/404") >= 0 || /error_code=300031/.test(navUrl)) {
          failures.push({ note_id: noteId, error: "[300031] note unavailable", elapsed_ms: Date.now() - noteStartTime });
          metrics.failureCount++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            remaining = notes.slice(i + 1);
            return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "consecutive_failures", hint: maxFailures + " consecutive 300031 failures" };
          }
          router.push({ path: "/explore" }).catch(function() {});
          await helper.sleep(2000);
          continue;
        }
      } catch(e) {}

      // ── 3. getNoteDetailByNoteId(noteId) ──
      var ns = helper.getStore("note");
      if (ns) {
        try {
          console.log(JSON.stringify({__bb_progress: {
            done: i, total: notes.length, noteId: noteId, success: null, error: null,
            stage: "fetch_detail", currentUrl: String(location.href || "")
          }}));
        } catch(e) {}

        if (ns.setCurrentNoteId) ns.setCurrentNoteId(noteId);
        if (ns.getNoteDetailByNoteId) {
          // 重置 firstRequestFinish 以确保 waitFor 等待新数据
          if (ns.noteDetailMap && ns.noteDetailMap[noteId] && ns.noteDetailMap[noteId].comments && ns.noteDetailMap[noteId].comments.firstRequestFinish === true) {
            ns.noteDetailMap[noteId].comments.firstRequestFinish = false;
          }
          try {
            await helper.withTimeout(ns.getNoteDetailByNoteId(noteId), 6000, "Note detail fetch timed out");
          } catch(e) {
            apiTimedOut = true;
          }
        }
      }

      tNav = Date.now() - noteStartTime;

      // 无论 apiTimedOut 是否为 true，都执行 waitFor — SPA 副作用可能已加载详情
      await helper.sleep(200);
      tApi = Date.now() - noteStartTime;

      // ── 4a. Phase 1: waitFor 详情就绪（40% 预算）──
      var detailBudget = Math.round(singleNoteTimeoutMs * 0.4);
      var detailReady = await helper.waitFor(
        function() {
          var nd = helper.findNoteInDetailMap(noteId);
          return (nd && nd.note) ? nd : null;
        },
        detailBudget
      );
      tDetail = Date.now() - noteStartTime;

      if (!detailReady) {
        error = "Note " + noteId + " detail timed out after " + detailBudget + "ms";
      } else {
        // ── 4b. Phase 2: waitFor 评论就绪（60% 预算）──
        var commentBudget = Math.round(singleNoteTimeoutMs * 0.6);
        var commentsReady = await helper.waitFor(
          function() {
            var nd = helper.findNoteInDetailMap(noteId);
            if (!nd || !nd.comments) return null;
            var cm = nd.comments;
            if (cm.list && cm.list.length > 0) return nd;
            if (cm.firstRequestFinish === true) return nd;
            return null;
          },
          commentBudget
        );
        tComment = Date.now() - noteStartTime;

        if (!commentsReady) {
          commentsTimeout = true;
          var nd = helper.findNoteInDetailMap(noteId);
          commentsDebug = {
            comments_exists: !!(nd && nd.comments),
            list_length: (nd && nd.comments && nd.comments.list) ? nd.comments.list.length : 0,
            first_request_finish: (nd && nd.comments) ? nd.comments.firstRequestFinish : null,
            has_more: (nd && nd.comments) ? nd.comments.hasMore : null
          };
        }

        detail = helper.toPlain(detailReady);
      }

      elapsed = Date.now() - noteStartTime;
    } catch(err) {
      elapsed = Date.now() - noteStartTime;
      error = err.message;
      try {
        var bodyText2 = document.body?.innerText || "";
        if (/300013|300017|安全限制|访问链接异常/.test(bodyText2)) {
          error = "[300013/300017] " + (error || "安全限制");
        }
      } catch(e) {}
    }

    metrics.maxElapsedMs = Math.max(metrics.maxElapsedMs, elapsed);

    if (detail && detail.note) {
      var noteData = detail.note;
      var token = noteData.xsecToken ?? xsecToken;

      // ── 5. 评论分页 (复用 comments-batch.js 逻辑) ──
      var allComments = [];
      var tPaginationStart = Date.now();

      if (detail.comments) {
        var commentsData = detail.comments;
        var page1Comments = Array.isArray(commentsData.list) ? commentsData.list : [];
        var hasMore = Boolean(commentsData.hasMore);
        var cursor = commentsData.cursor || "";

        // 提取 page-1 评论
        for (var ci = 0; ci < page1Comments.length; ci++) {
          var c = page1Comments[ci];
          allComments.push({
            comment_id: c.id,
            note_id: noteId,
            content: c.content || c.text || null,
            like_count: Number(c.likeCount ?? c.like_count ?? c.likes) ?? null,
            created_time: c.createTime ?? c.create_time ?? c.time ?? null,
            ip_location: c.ipLocation ?? c.ip_location ?? null,
            user: helper.normalizeUser(c.user_info || c.userInfo || c.user || {}),
            sub_comment_count: Number(c.subCommentCount ?? c.sub_comment_count) ?? 0,
            target_comment_id: c.targetCommentId ?? c.target_comment_id ?? null
          });
        }

        // Pages 2+: fetchComments(noteId, cursor)
        if (hasMore && maxCommentPages > 1) {
          for (var page = 2; page <= maxCommentPages; page++) {
            var pageOk = false;

            if (ns && ns.noteRequest && typeof ns.noteRequest.fetchComments === "function") {
              try {
                await helper.withTimeout(
                  ns.noteRequest.fetchComments.call(ns.noteRequest, noteId, cursor),
                  8000,
                  "fetchComments page " + page + " timeout"
                );
                await helper.sleep(800);

                var updated = await helper.waitFor(function() {
                  var u = helper.findNoteInDetailMap(noteId);
                  if (!u || !u.comments || !Array.isArray(u.comments.list)) return null;
                  return u;
                }, 3000, 200);

                if (updated && updated.comments && Array.isArray(updated.comments.list)) {
                  var newList = updated.comments.list;
                  var existingIds = {};
                  for (var ei = 0; ei < allComments.length; ei++) existingIds[allComments[ei].comment_id] = true;
                  var newCount = 0;
                  for (var ni = 0; ni < newList.length; ni++) {
                    if (!existingIds[newList[ni].id]) {
                      var nc = newList[ni];
                      allComments.push({
                        comment_id: nc.id,
                        note_id: noteId,
                        content: nc.content || nc.text || null,
                        like_count: Number(nc.likeCount ?? nc.like_count ?? nc.likes) ?? null,
                        created_time: nc.createTime ?? nc.create_time ?? nc.time ?? null,
                        ip_location: nc.ipLocation ?? nc.ip_location ?? null,
                        user: helper.normalizeUser(nc.userInfo ?? nc.user_info ?? nc.user ?? {}),
                        sub_comment_count: Number(nc.subCommentCount ?? nc.sub_comment_count) ?? 0,
                        target_comment_id: nc.targetCommentId ?? nc.target_comment_id ?? null
                      });
                      newCount++;
                    }
                  }
                  hasMore = Boolean(updated.comments.hasMore);
                  cursor = updated.comments.cursor || "";
                  pageOk = newCount > 0;
                  if (!hasMore) break;
                }
              } catch(e) {}
            }

            if (!pageOk) break;
            await helper.sleep(300 + Math.random() * 400);
          }
        }
      }

      tPagination = Date.now() - tPaginationStart;
      elapsed = Date.now() - noteStartTime;

      // ── 6. 构造返回结果 ──
      var resultItem = {
        note_id: noteId,
        xsec_token: token,
        xsec_source: xsecSource || "pc_search",
        title: noteData.title ?? null,
        desc: noteData.desc ?? null,
        type: noteData.type ?? null,
        url: token ? helper.buildNoteUrl(noteId, token, xsecSource) : ("https://www.xiaohongshu.com/explore/" + noteId),
        author: noteData.user?.nickname ?? null,
        author_id: noteData.user?.userId ?? noteData.user?.user_id ?? null,
        likes: noteData.interactInfo?.likedCount ?? null,
        comments: noteData.interactInfo?.commentCount ?? null,
        collects: noteData.interactInfo?.collectedCount ?? null,
        shares: noteData.interactInfo?.shareCount ?? null,
        tags: Array.isArray(noteData.tagList) ? noteData.tagList.map(function(tag) { return tag?.name; }).filter(Boolean) : [],
        images: Array.isArray(noteData.imageList)
          ? noteData.imageList.map(function(img) { return img?.urlDefault ?? img?.urlPre ?? img?.url ?? img?.infoList?.[0]?.url; }).filter(Boolean)
          : [],
        ip_location: noteData.ipLocation ?? null,
        created_time: noteData.time ?? null,
        last_update_time: noteData.lastUpdateTime ?? null,
        comments_data: allComments,
        _diagnostics: {
          elapsed_ms: elapsed,
          slow: elapsed > 5000,
          comments_timeout: commentsTimeout,
          comments_debug: commentsDebug,
          breakdown_ms: {
            nav: tNav,
            api: tApi - tNav,
            detail: tDetail - tApi,
            comment: tComment > 0 ? tComment - tDetail : 0,
            pagination: tPagination
          }
        }
      };

      collected.push(resultItem);
      metrics.successCount++;
      metrics.totalCommentCount += allComments.length;
      totalElapsed += elapsed;
      consecutiveFailures = 0;

      if (elapsed > 5000) metrics.slowNotes++;

      // ── 7. 清理 noteDetailMap ──
      var currentNoteStore = helper.getStore("note");
      if (currentNoteStore && currentNoteStore.noteDetailMap) {
        delete currentNoteStore.noteDetailMap[noteId];
      }
    } else {
      failures.push({ note_id: noteId, error: error || "Unknown error", elapsed_ms: elapsed });
      metrics.failureCount++;
      consecutiveFailures++;

      if (consecutiveFailures >= maxFailures) {
        remaining = notes.slice(i + 1);
        return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "consecutive_failures", hint: maxFailures + " consecutive failures detected" };
      }
    }

    // ── 8. progress 事件 ──
    try {
      console.log(JSON.stringify({__bb_progress: {
        done: i + 1, total: notes.length, noteId: noteId,
        success: !!detail && !!detail.note, error: error || null,
        commentCount: detail && detail.note ? (collected[collected.length - 1]?.comments_data?.length || 0) : 0,
        collected: collected.length, failures: failures.length,
        currentUrl: String(location.href || ""), stage: "note_complete"
      }}));
    } catch(e) {}

    // ── 9. 自适应延迟 ──
    if (i < notes.length - 1) {
      var jitter = Math.random() * baseDelayMs * 0.3;
      await helper.sleep(baseDelayMs + jitter);
    }
  }

  metrics.avgElapsedMs = metrics.successCount > 0 ? Math.round(totalElapsed / metrics.successCount) : 0;

  return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "completed" };
}
