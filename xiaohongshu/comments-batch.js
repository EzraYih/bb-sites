/* @meta
{  "name": "xiaohongshu/comments-batch",
  "description": "Batch fetch note comments via SPA store (anti-scraping header aware) with pagination",
  "domain": "www.xiaohongshu.com",
  "args": {
    "notes": {"required": true, "description": "JSON array of {noteId, xsecToken}"},
    "max_pages": {"required": false, "description": "Max comment pages per note (default 3)"},
    "time_budget_ms": {"required": false, "description": "Max time for this batch (default 60000)"},
    "single_note_timeout_ms": {"required": false, "description": "Timeout for single note (default 15000)"},
    "max_failures": {"required": false, "description": "Max consecutive failures before abort (default 3)"},
    "min_delay_ms": {"required": false, "description": "Min delay between notes (default 1000)"},
    "max_delay_ms": {"required": false, "description": "Max delay between notes (default 2000)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comments-batch --notes '[...]'"
}
*/

async function(args) {
  if (!args.notes) return { error: "Missing argument: notes" };

  var notes = typeof args.notes === "string" ? JSON.parse(args.notes) : args.notes;
  if (!Array.isArray(notes)) return { error: "notes must be an array" };

  var maxPages = args.max_pages ?? 3;
  var timeBudgetMs = args.time_budget_ms ?? 60000;
  var singleNoteTimeoutMs = args.single_note_timeout_ms ?? 15000;
  var maxFailures = args.max_failures ?? 3;
  var minDelayMs = Number(args.min_delay_ms) || 1000;
  var maxDelayMs = Number(args.max_delay_ms) || 2000;

  function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }
  function withTimeout(promise, ms, msg) {
    return Promise.race([promise, sleep(ms).then(function() { throw new Error(msg || "timeout"); })]);
  }
  function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
  function getGlobals() { return getApp()?.config?.globalProperties || null; }
  function getPinia() { return getGlobals()?.$pinia || null; }
  function getRouter() { return getGlobals()?.$router || null; }
  function getStore(name) { return getPinia()?._s?.get(name) || null; }

  // Condition-based wait: poll predicate every 200ms until true or timeout
  async function waitFor(predicate, timeoutMs, intervalMs) {
    if (intervalMs === undefined) intervalMs = 200;
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { var result = predicate(); if (result) return result; } catch(e) {}
      await sleep(intervalMs);
    }
    return null;
  }

  function normalizeUser(user) {
    if (!user || typeof user !== "object") return null;
    return {
      nickname: user.nickname ?? user.name ?? user.nickName ?? null,
      userid: user.user_id ?? user.userId ?? user.id ?? null,
      red_id: user.red_id ?? user.redId ?? null,
      avatar: user.image ?? user.avatar ?? null
    };
  }

  var startTime = Date.now();
  var collected = [], failures = [], remaining = [];
  var consecutiveFailures = 0;
  var baseDelayMs = minDelayMs;

  var metrics = {
    totalNotes: notes.length, successCount: 0, failureCount: 0,
    avgElapsedMs: 0, maxElapsedMs: 0, slowNotes: 0, totalCommentCount: 0
  };

  // ── SPA 就绪等待 ──
  // prepareDetailTab 已确认 SPA 就绪。此处失败说明 SPA 在批次执行期间崩溃。
  // 不执行 location.href 自愈 — 整页导航会摧毁 CDP 执行上下文。
  // 直接返回错误，由工作流层降级并发并整批回退。
  var appReady = await waitFor(function() { return getApp(); }, 8000, 250);
  if (!appReady) return {
    error: "Vue app not found",
    hint: "SPA became unavailable during batch execution",
    stopped_reason: "spa_not_ready"
  };

  var router = getRouter();
  if (!router) return { error: "Router not available: page not fully loaded" };

  for (var i = 0; i < notes.length; i++) {
  // ── 300013/300017 会话级安全限制检测 ──
  try {
    var bodyText = document.body?.innerText || "";
    if (/300013|300017|安全限制|访问链接异常/.test(bodyText)) {
      remaining = notes.slice(i);
      return {
        collected: collected, failures: failures, remaining: remaining,
        metrics: metrics, stopped_reason: "consecutive_failures",
        hint: "platform limit (300013/300017) detected"
      };
    }
  } catch(e) {}

    var note = notes[i];
    var noteId = note.noteId || note.note_id;
    var xsecToken = note.xsecToken || note.xsec_token || "";
    var xsecSource = note.xsecSource || note.xsec_source || "pc_search";
    var noteStartTime = Date.now();
    var elapsed = 0, error = null;
    var allComments = [];
    var lastFetchError = null;

    if (Date.now() - startTime > timeBudgetMs) {
      remaining = notes.slice(i);
      return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "time_budget_exceeded" };
    }

    try {
      // Navigate to note page via SPA
      router.push({
        path: '/explore/' + noteId,
        query: {
          xsec_token: xsecToken || '',
          xsec_source: xsecSource || 'pc_search',
          source: 'web_explore_feed',
        }
      }).catch(function() {});

      // 阶段性 progress 事件：router.push 已调用
      try {
        console.log(JSON.stringify({__bb_progress: {
          done: i,
          total: notes.length,
          noteId: noteId,
          success: null,
          error: null,
          stage: "router_pushed",
          currentUrl: String(location.href || "")
        }}));
      } catch(e) {}

      // Level 1: Wait for route change OR store to start loading (max 2000ms)
      // Instead of blind sleep(2000), we condition-wait and exit early.
      await waitFor(function() {
        var ns = getStore("note");
        if (ns && ns.noteDetailMap && ns.noteDetailMap[noteId]) return true;
        if (ns && ns.loadingNoteId === noteId) return true;
        return false;
      }, 2000, 200);
      // If the condition wasn't met within 2s, we proceed anyway (same timing as before)

      // ── 300031 早期检测（router.push 后，API 调用前）──
      // 300031 由 SPA 客户端路由触发，router.push 后 ~500ms URL 变为 /404?error_code=300031
      // 此时 CDP eval 上下文存活，可检测。检测到后标记当前笔记失效，不调用 API。
      try {
        var navUrl = String(location.href || "");
        if (navUrl.indexOf("/404") >= 0 || /error_code=300031/.test(navUrl)) {
          failures.push({ note_id: noteId, error: "[300031] note unavailable", elapsed_ms: Date.now() - noteStartTime });
          metrics.failureCount++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            remaining = notes.slice(i + 1);
            return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "consecutive_failures" };
          }
          router.push({ path: "/explore" }).catch(function() {});
          await sleep(2000);
          continue;
        }
      } catch(e) {}

      var ns = getStore("note");

      // ── Clear stale cache entry to force fresh fetch ──
      if (ns && ns.noteDetailMap) {
        delete ns.noteDetailMap[noteId];
        try { if (ns.setCurrentNoteId) ns.setCurrentNoteId(noteId); } catch(e) {}
      }

      // Direct comment API call via SPA signed request layer.
      // Bypasses heavy getNoteDetailByNoteId() which loads full note detail (images, author, etc).
      // fetchComments() returns comments data into noteDetailMap[noteId].comments within ~1s.
      if (ns && ns.noteRequest && typeof ns.noteRequest.fetchComments === "function") {
        // 阶段性 progress 事件：正在调用 fetchComments API
        try {
          console.log(JSON.stringify({__bb_progress: {
            done: i,
            total: notes.length,
            noteId: noteId,
            success: null,
            error: null,
            stage: "fetch_comments",
            currentUrl: String(location.href || "")
          }}));
        } catch(e) {}
        try {
          await withTimeout(ns.noteRequest.fetchComments.call(ns.noteRequest, noteId, ""), 6000, "fetchComments timed out");
        } catch(e) { lastFetchError = e.message; }
        // Short wait for the response to propagate to store
        await new Promise(function(r) { setTimeout(r, 800); });
      }
      // Wait for comments data in store (fetchComments() populates noteDetailMap[noteId].comments)
      // 阶段性 progress 事件：等待 store 数据就绪
      try {
        console.log(JSON.stringify({__bb_progress: {
          done: i,
          total: notes.length,
          noteId: noteId,
          success: null,
          error: null,
          stage: "wait_store",
          currentUrl: String(location.href || "")
        }}));
      } catch(e) {}
      var detail = await waitFor(function() {
        var current = getStore("note")?.noteDetailMap?.[noteId];
        if (!current || !current.comments) return null;
        var cd = current.comments;
        if (Array.isArray(cd.list) || cd.firstRequestFinish) return current;
        return null;
      }, singleNoteTimeoutMs, 200);
      // Fallback: if comments didn't load, still extract whatever is available
      if (!detail) {
        try {
          var staleDetail = getStore("note")?.noteDetailMap?.[noteId];
          if (staleDetail && staleDetail.comments) detail = staleDetail;
        } catch(e) {}
      }
      if (!detail) { error = "No comments data in store"; continue; }
      if (!detail) { error = "Note detail not found in store"; continue; }

      // ── Page 1: extract from SPA store ──
      var commentsData = detail.comments || null;
      var page1Comments = commentsData && Array.isArray(commentsData.list) ? commentsData.list : [];
      var hasMore = commentsData ? Boolean(commentsData.hasMore) : false;
      var cursor = commentsData ? (commentsData.cursor || "") : "";

      for (var ci = 0; ci < page1Comments.length; ci++) {
        var c = page1Comments[ci];
        allComments.push({
          id: c.id, content: c.content || c.text || null,
          like_count: Number(c.likeCount ?? c.like_count ?? c.likes) ?? null,
          created_time: c.createTime ?? c.create_time ?? c.time ?? null,
          ip_location: c.ipLocation ?? c.ip_location ?? null,
          user: normalizeUser(c.user_info || c.userInfo || c.user || {}),
          sub_comment_count: Number(c.subCommentCount ?? c.sub_comment_count) ?? 0,
          target_comment_id: c.targetCommentId ?? c.target_comment_id ?? null
        });
      }

      // ── Pages 2+: try SPA API service first, fall back to POST ──
      if (hasMore && maxPages > 1) {
        for (var page = 2; page <= maxPages; page++) {
          if (Date.now() - startTime > timeBudgetMs) break;
          var pageOk = false;

          // Strategy A: fetch next page via direct API call with cursor
          if (ns && ns.noteRequest && typeof ns.noteRequest.fetchComments === "function") {
            try {
              await withTimeout(ns.noteRequest.fetchComments.call(ns.noteRequest, noteId, cursor), 8000, "fetchComments page " + page + " timeout");
              await new Promise(function(r) { setTimeout(r, 800); });
              var updated = await waitFor(function() {
                var u = getStore("note")?.noteDetailMap?.[noteId];
                if (!u || !u.comments || !Array.isArray(u.comments.list)) return null;
                return u;
              }, 3000, 200);
              if (updated && updated.comments && Array.isArray(updated.comments.list)) {
                var newList = updated.comments.list;
                var existingIds = {};
                for (var ei = 0; ei < allComments.length; ei++) existingIds[allComments[ei].id] = true;
                for (var ni = 0; ni < newList.length; ni++) {
                  if (!existingIds[newList[ni].id]) {
                    var nc = newList[ni];
                    allComments.push({
                      id: nc.id, content: nc.content || nc.text || null,
                      like_count: Number(nc.likeCount ?? nc.like_count ?? nc.likes) ?? null,
                      created_time: nc.createTime ?? nc.create_time ?? nc.time ?? null,
                      ip_location: nc.ipLocation ?? nc.ip_location ?? null,
                      user: normalizeUser(nc.userInfo ?? nc.user_info ?? nc.user ?? {}),
                      sub_comment_count: Number(nc.subCommentCount ?? nc.sub_comment_count) ?? 0,
                      target_comment_id: nc.targetCommentId ?? nc.target_comment_id ?? null
                    });
                  }
                }
                hasMore = Boolean(updated.comments.hasMore);
                cursor = updated.comments.cursor || "";
                pageOk = newList.length > 0;
                if (!hasMore) break;
              }
            } catch(e) { lastFetchError = e.message; }
          }

          if (!pageOk) break;
          await sleep(300 + Math.random() * 400);
        }
      }

      // Clean up noteDetailMap to prevent SPA reactivity bloat (same as notes-batch.js)
      if (ns && ns.noteDetailMap) {
        delete ns.noteDetailMap[noteId];
      }

      elapsed = Date.now() - noteStartTime;
      if (allComments.length === 0 && !error) error = "No comments found via store" + (lastFetchError ? " (last error: " + lastFetchError + ")" : "");

    } catch (err) {
      elapsed = Date.now() - noteStartTime;
      error = error || err.message;
    }

    metrics.maxElapsedMs = Math.max(metrics.maxElapsedMs, elapsed);

    if (error) {
      failures.push({ note_id: noteId, error: error || "Unknown error", elapsed_ms: elapsed });
      metrics.failureCount++;
      consecutiveFailures++;
      // 对称增长：失败后退避
      baseDelayMs = Math.min(baseDelayMs * 1.3, maxDelayMs * 2);
      if (consecutiveFailures >= maxFailures) {
        remaining = notes.slice(i + 1);
        return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: "consecutive_failures" };
      }
    } else {
      collected.push({
        note_id: noteId, xsec_token: xsecToken,
        comment_count: allComments.length, comments: allComments,
        _diagnostics: { elapsed_ms: elapsed }
      });
      metrics.successCount++;
      consecutiveFailures = 0;
      // 对称衰减：撤销之前的失败增长
      baseDelayMs = Math.max(baseDelayMs / 1.3, minDelayMs);
      metrics.totalCommentCount += allComments.length;
      if (elapsed > 10000) metrics.slowNotes++;
    }

    // Emit progress for streaming consumers
    try {
      console.log(JSON.stringify({__bb_progress: {
        done: i + 1,
        total: notes.length,
        noteId: noteId,
        success: !error,
        error: error || null,
        commentCount: allComments.length,
        collected: collected.length,
        failures: failures.length,
        currentUrl: String(location.href || ""),
        stage: "note_complete"
      }}));
    } catch(e) {}

    if (i < notes.length - 1) {
      var jitter = Math.random() * baseDelayMs * 0.3;
      await sleep(baseDelayMs + jitter);
    }
  }

  metrics.avgElapsedMs = metrics.successCount > 0 ? Math.round(metrics.totalCommentCount) : 0;
  return { collected: collected, failures: failures, remaining: remaining, metrics: metrics, stopped_reason: remaining.length > 0 ? "time_budget_exceeded" : "completed" };
}




