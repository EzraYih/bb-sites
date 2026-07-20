/* @meta
{  "name": "xiaohongshu/notes-batch",
  "description": "Batch fetch note details with adaptive timeout and rate limiting detection",
  "domain": "www.xiaohongshu.com",
  "args": {
    "notes": {"required": true, "description": "JSON array of {noteId, xsecToken}"},
    "time_budget_ms": {"required": false, "description": "Max time for this batch (default 60000)"},
    "single_note_timeout_ms": {"required": false, "description": "Timeout for single note (default 8000)"},
    "max_failures": {"required": false, "description": "Max consecutive failures before abort (default 3)"},
    "min_delay_ms": {"required": false, "description": "Min delay between notes (default 600)"},
    "max_delay_ms": {"required": false, "description": "Max delay between notes (default 1200)"},
    "external_min_delay_ms": {"required": false, "description": "External override for min delay (from cross-batch adaptive)"},
    "external_max_delay_ms": {"required": false, "description": "External override for max delay (from cross-batch adaptive)"},
    "collect_comments": {"required": false, "description": "Also collect first-page comments alongside note detail (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/notes-batch --notes '[{\"noteId\":\"abc123\",\"xsecToken\":\"token123\"}]'"
}
*/

async function(args) {
  if (!args.notes) return { error: "Missing argument: notes" };

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
    async function waitFor(predicate, timeoutMs = 8000, intervalMs = 250) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const result = await predicate();
          if (result) return result;
        } catch {}
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
    function parseNoteInput(input) {
      const raw = String(input ?? "").trim();
      let noteId = raw;
      let xsecToken = null;
      if (!raw) return { noteId: "", xsecToken: null };
      try {
        const url = new URL(raw, location.origin);
        const match = url.pathname.match(/\/(?:explore|search_result)\/([a-z0-9]+)/i);
        if (match) noteId = match[1];
        xsecToken = url.searchParams.get("xsec_token");
      } catch {}
      const idMatch = raw.match(/(?:explore|search_result)\/([a-z0-9]+)/i);
      if (idMatch) noteId = idMatch[1];
      const tokenMatch = raw.match(/[?&]xsec_token=([^&]+)/i);
      if (tokenMatch) xsecToken = tokenMatch[1];
      return { noteId, xsecToken };
    }
    function buildNoteUrl(noteId, token, xsecSource) {
      if (!noteId) return null;
      if (!token) return `https://www.xiaohongshu.com/explore/${noteId}`;
      const source = xsecSource || "pc_search";
      return `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}&xsec_source=${encodeURIComponent(source)}`;
    }
    const tokenMemory = new Map();
    function rememberNoteTokens(items) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const id = item?.id || item?.noteId || item?.note_id;
        const token = item?.xsecToken || item?.xsec_token;
        if (id && token) tokenMemory.set(id, token);
      }
    }
    function resolveNoteToken(noteId) {
      return tokenMemory.get(noteId) || null;
    }
    function normalizeUser(user) {
      if (!user || typeof user !== "object") return null;
      const nickname = user.nickname ?? user.name ?? user.nickName ?? null;
      const userId = user.userId ?? user.user_id ?? user.userid ?? user.id ?? null;
      const redId = user.redId ?? user.red_id ?? user.redid ?? null;
      const desc = user.desc ?? user.description ?? null;
      const gender = user.gender ?? null;
      if (!nickname && !userId && !redId) return null;
      return {
        nickname,
        red_id: redId,
        desc,
        gender,
        userid: userId,
        url: userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : null
      };
    }
    function mapNoteCardItem(item) {
      const card = item?.noteCard || item?.note_card || item;
      if (!card || typeof card !== "object") return null;
      const noteId = item?.id ?? card.noteId ?? card.note_id ?? null;
      const xsecToken = item?.xsecToken ?? item?.xsec_token ?? card.xsecToken ?? card.xsec_token ?? null;
      const user = card.user || {};
      if (!noteId || !/^[a-f0-9]+$/i.test(String(noteId))) return null;
      return {
        id: noteId,
        note_id: noteId,
        xsec_token: xsecToken,
        title: card.displayTitle ?? card.display_title ?? card.title ?? null,
        type: card.type ?? null,
        url: xsecToken
          ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=`
          : `https://www.xiaohongshu.com/explore/${noteId}`,
        author: user.nickname ?? user.nickName ?? null,
        author_id: user.userId ?? user.user_id ?? null,
        author_followers: user.fans ?? null,
        likes: card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? null,
        cover: card.cover?.urlDefault ?? card.cover?.urlPre ?? card.cover?.url ?? card.imageList?.[0]?.urlDefault ?? null,
        time: card.lastUpdateTime ?? card.last_update_time ?? card.time ?? null
      };
    }
    function flattenNoteGroups(groups) {
      if (!Array.isArray(groups)) return [];
      const items = [];
      for (const group of groups) {
        if (!group || typeof group !== "object") continue;
        if (Array.isArray(group)) { items.push(...group); continue; }
        if (group.noteGroup && Array.isArray(group.noteGroup)) { items.push(...group.noteGroup); continue; }
        if (Array.isArray(group.items)) { items.push(...group.items); continue; }
      }
      return items;
    }
    function collectNoteItems() {
      const noteStore = getStore("note");
      if (!noteStore) return [];
      const raw = noteStore.noteList || noteStore.note_list || noteStore.notes || [];
      if (Array.isArray(raw)) return raw;
      try { return Object.values(raw); } catch { return []; }
    }
    function collectNoteDetailMap() {
      const noteStore = getStore("note");
      if (!noteStore) return {};
      const map = noteStore.noteDetailMap || noteStore.note_detail_map || noteStore.detail || {};
      return map;
    }
    function findNoteInDetailMap(noteId) {
      const map = collectNoteDetailMap();
      if (typeof map.get === "function") return map.get(noteId);
      if (map[noteId]) return map[noteId];
      for (const [key, value] of Object.entries(map)) {
        if (key === noteId || value?.noteId === noteId || value?.note_id === noteId) return value;
      }
      return null;
    }
    function findNoteInNoteList(noteId) {
      const items = collectNoteItems();
      for (const item of items) {
        const id = item?.id || item?.noteId || item?.note_id || item?.noteCard?.noteId || item?.note_card?.note_id;
        if (id === noteId) return mapNoteCardItem(item);
      }
      return null;
    }
    return {
      sleep, getApp, getGlobals, getPinia, getRouter, getStore, toPlain, waitFor, withTimeout,
      parseNoteInput, buildNoteUrl, rememberNoteTokens, resolveNoteToken,
      normalizeUser, mapNoteCardItem, flattenNoteGroups, collectNoteItems,
      collectNoteDetailMap, findNoteInDetailMap, findNoteInNoteList
    };
  })());

  // Validate and parse note inputs
  let notes;
  try {
    notes = typeof args.notes === "string" ? JSON.parse(args.notes) : args.notes;
  } catch {
    return { error: "Invalid notes argument, must be a JSON array" };
  }

  if (!Array.isArray(notes) || notes.length === 0) {
    return { error: "No valid notes provided", hint: "Provide a JSON array of {noteId, xsecToken} objects" };
  }

  // Config
  const timeBudgetMs = Number(args.time_budget_ms) || 60000;
  let singleNoteTimeoutMs = Number(args.single_note_timeout_ms) || Number(args.singleNoteTimeoutMs) || 8000;
  const maxFailures = Number(args.max_failures) || 3;
  const minDelayMs = Number(args.external_min_delay_ms) || Number(args.min_delay_ms) || 600;
  const maxDelayMs = Number(args.external_max_delay_ms) || Number(args.max_delay_ms) || 1200;
  const collectComments = args.collect_comments === true || args.collect_comments === "true";

  // Wait for SPA to be ready before processing notes.
  // prepareDetailTab 已确认 SPA 就绪。此处失败说明 SPA 在批次执行期间崩溃。
  // 不执行 location.href 自愈 — 整页导航会摧毁 CDP 执行上下文。
  // 直接返回错误，由工作流层降级并发并整批回退。
  let appReady = await helper.waitFor(() => helper.getApp(), 8000, 250);

  if (!appReady) {
    return {
      error: "Vue app not found",
      hint: "SPA became unavailable during batch execution",
      stopped_reason: "spa_not_ready"
    };
  }



  const collected = [];
  const failures = [];
  let remaining = [];
  let consecutiveFailures = 0;
  let consecutiveSlowNotes = 0;
  let baseDelayMs = minDelayMs;
  let totalElapsed = 0;

  const metrics = {
    totalNotes: notes.length,
    successCount: 0,
    failureCount: 0,
    avgElapsedMs: 0,
    maxElapsedMs: 0,
    slowNotes: 0
  };

  let startTime = Date.now();

  for (let i = 0; i < notes.length; i++) {
    // Check time budget
    let elapsed = Date.now() - startTime;
    if (elapsed >= timeBudgetMs) {
      remaining = notes.slice(i);
      break;
    }

    // Pre-check for 300013/300017 platform limit
    try {
      const bodyText = document.body?.innerText || "";
      if (/300013|300017|安全限制|访问链接异常/.test(bodyText)) {
        const refNoteId = notes[i].noteId || notes[i].note_id || "unknown";
        failures.push({
          note_id: refNoteId,
          error: "[300013/300017] platform limit",
          elapsed_ms: 0
        });
        metrics.failureCount++;
        remaining = notes.slice(i);
        return {
          collected, failures, remaining, metrics,
          stopped_reason: "consecutive_failures",
          hint: "platform limit (300013/300017) detected"
        };
      }
    } catch {}

    const { noteId, xsecToken, xsecSource } = notes[i];
    let error = null;
    let detail = null;
    let noteStartTime = Date.now();
    let tNav = 0, tApi = 0, tDetail = 0, tComment = 0;

    try {
      // Layer 1: Navigate to note page (SPA navigation via relative path)
      const router = helper.getRouter();
      if (!router) {
        error = "Vue Router not found";
      } else if (!noteId) {
        error = "Missing noteId";
      } else {
        router.push({
          path: `/explore/${noteId}`,
          query: {
            xsec_token: xsecToken || "",
            xsec_source: xsecSource || "pc_search",
            source: "web_explore_feed",
          }
        }).catch(() => {});

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

        await helper.sleep(1800);
      }

      // ── 300031 早期检测（router.push 后，API 调用前）──
      try {
        const navUrl = String(location.href || "");
        if (navUrl.indexOf("/404") >= 0 || /error_code=300031/.test(navUrl)) {
          failures.push({ note_id: noteId, error: "[300031] note unavailable", elapsed_ms: Date.now() - noteStartTime });
          metrics.failureCount++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            remaining = notes.slice(i + 1);
            return { collected, failures, remaining, metrics, stopped_reason: "consecutive_failures", hint: `${maxFailures} consecutive 300031 failures` };
          }
          const r = helper.getRouter();
          if (r) r.push({ path: "/explore" }).catch(() => {});
          await helper.sleep(2000);
          continue;
        }
      } catch {}

      // Trigger API fetch via noteStore (matches feed.js pattern)
      const ns = helper.getStore("note");
      if (ns) {
        // 阶段性 progress 事件：正在调用 API
        try {
          console.log(JSON.stringify({__bb_progress: {
            done: i,
            total: notes.length,
            noteId: noteId,
            success: null,
            error: null,
            stage: "fetch_detail",
            currentUrl: String(location.href || "")
          }}));
        } catch(e) {}
        if (ns.setCurrentNoteId) ns.setCurrentNoteId(noteId);
        if (ns.getNoteDetailByNoteId) {
          try {
            await helper.withTimeout(ns.getNoteDetailByNoteId(noteId), 6000, "Note detail fetch timed out");
          } catch {}
        }
        // Ensure comment placeholder does not short-circuit waitFor
        if (collectComments) {
          if (ns?.noteDetailMap?.[noteId]?.comments?.firstRequestFinish === true) {
            ns.noteDetailMap[noteId].comments.firstRequestFinish = false;
          }
        }
      }
      tNav = Date.now() - noteStartTime;
      if (!error) {
        // Layer 2: Wait for store response
        await helper.sleep(200);
        tApi = Date.now() - noteStartTime;

        // Layer 3: Single waitFor for note detail + optional comments (feed.js pattern)
        let current = await helper.waitFor(
          () => {
            const nd = helper.findNoteInDetailMap(noteId);
            if (!nd?.note) return null;
            if (!collectComments) return nd;
            // Wait for first-page comments loaded by SPA
            const cm = nd.comments;
            if (cm?.list?.length > 0) return nd;
            return null;
          },
          collectComments ? singleNoteTimeoutMs + 4000 : singleNoteTimeoutMs
        );
        tDetail = Date.now() - noteStartTime;

        // Record comment timing if applicable
        if (current && current.comments?.list) {
          tComment = Date.now() - noteStartTime;
        }
        if (tComment === 0) tComment = Date.now() - noteStartTime;

        // Handle timeout scenario with meaningful error message
        if (!current) {
          error = "Note " + noteId + " timed out after " + (collectComments ? singleNoteTimeoutMs + 4000 : singleNoteTimeoutMs) + "ms";
        } else {
          detail = helper.toPlain(current);
        }



        elapsed = Date.now() - noteStartTime;
      }
    } catch (err) {
      elapsed = Date.now() - noteStartTime;
      error = err.message;
      try {
        const bodyText = document.body?.innerText || "";
if (/300013|300017|安全限制|访问链接异常/.test(bodyText)) {
  error = "[300013/300017] " + (error || "安全限制");
}
      } catch {}
    }
    // Layer 3: Performance monitoring
    metrics.maxElapsedMs = Math.max(metrics.maxElapsedMs, elapsed);

    if (detail && detail.note) {
      // Success
      const note = detail.note;
      const token = note.xsecToken ?? xsecToken;

      helper.rememberNoteTokens([{ id: noteId, xsecToken: token, noteCard: { noteId } }]);

      const resultItem = {
        note_id: noteId,
        xsec_token: token,
        xsec_source: xsecSource || "pc_search",
        title: note.title ?? null,
        desc: note.desc ?? null,
        type: note.type ?? null,
        url: token ? helper.buildNoteUrl(noteId, token, xsecSource) : `https://www.xiaohongshu.com/explore/${noteId}`,
        author: note.user?.nickname ?? null,
        author_id: note.user?.userId ?? note.user?.user_id ?? null,
        author_followers: note.user?.fans ?? null,
        likes: note.interactInfo?.likedCount ?? null,
        comments: note.interactInfo?.commentCount ?? null,
        collects: note.interactInfo?.collectedCount ?? null,
        shares: note.interactInfo?.shareCount ?? null,
        tags: Array.isArray(note.tagList) ? note.tagList.map((tag) => tag?.name).filter(Boolean) : [],
        images: Array.isArray(note.imageList)
          ? note.imageList.map((img) => img?.urlDefault ?? img?.urlPre ?? img?.url ?? img?.infoList?.[0]?.url).filter(Boolean)
          : [],
        ip_location: note.ipLocation ?? null,
        created_time: note.time ?? null,
        last_update_time: note.lastUpdateTime ?? null,
        _diagnostics: {
          elapsed_ms: elapsed,
          slow: elapsed > 5000,
          breakdown_ms: {
            nav: tNav,
            api: tApi - tNav,
            detail: tDetail - tApi,
            comment: tComment > 0 ? tComment - tDetail : 0
          }
        }
      };

      // Collect comments data if available
      if (collectComments && detail.comments) {
        resultItem.comments_data = {
          list: (detail.comments.list || []).map((c) => ({
            id: c.id,
            content: c.content,
            likeCount: c.likeCount ?? c.like_count ?? 0,
            userInfo: {
              nickname: c.userInfo?.nickname ?? null,
              userId: c.userInfo?.userId ?? c.userInfo?.user_id ?? null,
            },
            createTime: c.createTime ?? c.create_time ?? null,
            subCommentCount: c.subCommentCount ?? c.sub_comment_count ?? 0,
          })),
          hasMore: detail.comments.hasMore ?? false,
          cursor: detail.comments.cursor ?? null,
        };
      }

      collected.push(resultItem);

      // Clean up noteDetailMap to prevent SPA reactivity bloat
      const currentNoteStore = helper.getStore("note");
      if (currentNoteStore && currentNoteStore.noteDetailMap) {
        delete currentNoteStore.noteDetailMap[noteId];
      }

      metrics.successCount++;
      totalElapsed += elapsed;
      consecutiveFailures = 0;

      // Response time monitoring
      if (elapsed > 5000) {
        consecutiveSlowNotes++;
        metrics.slowNotes++;
        if (consecutiveSlowNotes >= 2) {
          baseDelayMs = Math.min(baseDelayMs * 1.3, maxDelayMs * 2);
          singleNoteTimeoutMs = Math.max(2000, Math.round(singleNoteTimeoutMs * 0.8));
        }
      } else {
        consecutiveSlowNotes = 0;
      }

    } else {
      // Failure
      failures.push({
        note_id: noteId,
        error: error || "Unknown error",
        elapsed_ms: elapsed
      });

      metrics.failureCount++;
      consecutiveFailures++;
      consecutiveSlowNotes++;

      // Layer 4: Consecutive failure protection
      if (consecutiveFailures >= maxFailures) {
        const remaining = notes.slice(i + 1);
        return {
          collected,
          failures,
          remaining,
          metrics,
          stopped_reason: "consecutive_failures",
          hint: `${maxFailures} consecutive failures detected, possible rate limiting`
        };
      }

      // Increase delay after failure
      baseDelayMs = Math.min(baseDelayMs * 1.3, maxDelayMs * 2);
    }

    // Emit progress for streaming consumers (bb-browser --progress polls console)
    try {
      console.log(JSON.stringify({__bb_progress: {
        done: i + 1,
        total: notes.length,
        noteId: noteId,
        success: !!detail && !!detail.note,
        error: error || null,
        collected: collected.length,
        failures: failures.length,
        currentUrl: String(location.href || ""),
        stage: "note_complete"
      }}));
    } catch(e) {}

    // Layer 5: Adaptive delay
    if (i < notes.length - 1) {
      const jitter = Math.random() * baseDelayMs * 0.3;
      await helper.sleep(baseDelayMs + jitter);
    }
  }

  // Calculate average elapsed time
  metrics.avgElapsedMs = metrics.successCount > 0
    ? Math.round(totalElapsed / metrics.successCount)
    : 0;

  return {
    collected,
    failures,
    remaining,
    metrics,
    stopped_reason: remaining.length > 0 ? "time_budget_exceeded" : "completed"
  };
}


