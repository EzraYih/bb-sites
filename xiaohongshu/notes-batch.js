/* @meta
{
  "name": "xiaohongshu/notes-batch",
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

  const helper = globalThis.__bbBrowserXhsHelper?.rememberNoteTokens
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
    function buildNoteUrl(noteId, token) {
      if (!noteId) return null;
      if (!token) return `https://www.xiaohongshu.com/explore/${noteId}`;
      return `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}&xsec_source=`;
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
        likes: card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? null,
        cover: card.cover?.urlDefault ?? card.cover?.urlPre ?? card.cover?.url ?? card.imageList?.[0]?.urlDefault ?? null,
        time: card.lastUpdateTime ?? card.last_update_time ?? card.time ?? null
      };
    }
    function flattenNoteGroups(groups) {
      const result = [];
      if (!Array.isArray(groups)) return result;
      for (const group of groups) {
        if (Array.isArray(group)) result.push(...group);
        else if (group) result.push(group);
      }
      return result;
    }
    function parseInitialState(html) {
      const match = html.match(/__INITIAL_STATE__=(\{[\s\S]*?\})<\/script>/);
      if (!match) throw new Error("SSR state not found");
      return (0, eval)("(" + match[1] + ")");
    }
    async function fetchHtml(url) {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return await response.text();
    }
    function findTokenInCollection(collection, noteId) {
      if (!Array.isArray(collection)) return null;
      for (const item of collection) {
        const id = item?.id || item?.noteId || item?.note_id;
        if (id === noteId) {
          const token = item?.xsecToken || item?.xsec_token;
          if (token) return token;
        }
        const card = item?.noteCard || item?.note_card;
        if (card) {
          const cardId = card.noteId || card.note_id;
          if (cardId === noteId) {
            const token = card.xsecToken || card.xsec_token;
            if (token) return token;
          }
        }
      }
      return null;
    }
    return {
      sleep, getPinia, getRouter, getStore, toPlain, waitFor, withTimeout,
      normalizeUser, mapNoteCardItem, flattenNoteGroups, parseInitialState, fetchHtml,
      parseNoteInput, buildNoteUrl, rememberNoteTokens, resolveNoteToken, findTokenInCollection
    };
  })());

  // Parse notes
  const notes = (() => {
    try {
      if (typeof args.notes === "string") return JSON.parse(args.notes);
      if (Array.isArray(args.notes)) return args.notes;
      return [];
    } catch { return []; }
  })();

  if (!Array.isArray(notes) || notes.length === 0) {
    return { error: "No valid notes provided", hint: "Provide a JSON array of {noteId, xsecToken} objects" };
  }

  // Config
  const timeBudgetMs = Number(args.time_budget_ms) || 60000;
  const singleNoteTimeoutMs = Number(args.single_note_timeout_ms) || 8000;
  const maxFailures = Number(args.max_failures) || 3;
  const minDelayMs = Number(args.external_min_delay_ms) || Number(args.min_delay_ms) || 600;
  const maxDelayMs = Number(args.external_max_delay_ms) || Number(args.max_delay_ms) || 1200;
  const collectComments = args.collect_comments === true || args.collect_comments === "true";

  const noteStore = helper.getStore("note");
  if (!noteStore) {
    return { error: "Note store not found", hint: "Ensure xiaohongshu.com is fully loaded" };
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

  const deadline = Date.now() + timeBudgetMs;

  for (let i = 0; i < notes.length; i++) {
    // Check time budget
    if (Date.now() >= deadline) {
      remaining = notes.slice(i);
      return {
        collected,
        failures,
        remaining,
        metrics: { ...metrics, avgElapsedMs: metrics.successCount > 0 ? Math.round(totalElapsed / metrics.successCount) : 0 },
        stopped_reason: "time_budget_exceeded",
        hint: `Time budget of ${timeBudgetMs}ms exceeded after processing ${i} notes`
      };
    }

    const { noteId, xsecToken } = notes[i];
    const noteStartTime = Date.now();

    if (!noteId) {
      failures.push({ note_id: null, error: "Missing noteId", elapsed_ms: 0 });
      metrics.failureCount++;
      continue;
    }

    if (!xsecToken) {
      failures.push({ note_id: noteId, error: "Missing xsecToken", elapsed_ms: 0 });
      metrics.failureCount++;
      continue;
    }

    // Layer 2: Single note timeout control
    let detail = null;
    let error = null;
    let elapsed = 0;
    let tNav = 0, tApi = 0, tDetail = 0, tComment = 0;

    try {
      detail = await helper.withTimeout(
        (async () => {
          // Navigate to note page if not already there
          const currentNoteId = noteStore.noteDetailMap ? Object.keys(noteStore.noteDetailMap)[0] : null;
          if (currentNoteId !== noteId) {
            const router = helper.getRouter();
            if (router) {
              router.push({
                path: `/explore/${noteId}`,
                query: { xsec_token: xsecToken, xsec_source: "" }
              }).catch(() => {});
              await helper.sleep(800);
              tNav = Date.now() - noteStartTime;
            }
          }

          // Call internal API
          if (noteStore.getNoteDetailByNoteId) {
            try {
              await noteStore.getNoteDetailByNoteId(noteId);
              tApi = Date.now() - noteStartTime;
            } catch {}
          }

          // Wait for data ready
          return await helper.waitFor(() => {
            const current = noteStore.noteDetailMap?.[noteId];
            if (!current?.note || current.note.noteId !== noteId) return null;
            if (tDetail === 0) tDetail = Date.now() - noteStartTime;
            if (!collectComments) return helper.toPlain(current);
            // Skip comment wait for notes with 0 comments
            if (current.note.interactInfo?.commentCount === 0) {
              if (tComment === 0) tComment = tDetail;
              return helper.toPlain(current);
            }
            // Also wait for auto-loaded comments
            const list = current.comments?.list;
            if (Array.isArray(list) && (list.length > 0 || current.comments?.firstRequestFinish)) {
              if (tComment === 0) tComment = Date.now() - noteStartTime;
              return helper.toPlain(current);
            }
            return null;
          }, collectComments ? singleNoteTimeoutMs + 4000 : singleNoteTimeoutMs);
        })(),
        collectComments ? singleNoteTimeoutMs + 4000 : singleNoteTimeoutMs,
        `Note ${noteId} timed out after ${collectComments ? singleNoteTimeoutMs + 4000 : singleNoteTimeoutMs}ms`
      );

      elapsed = Date.now() - noteStartTime;

    } catch (err) {
      elapsed = Date.now() - noteStartTime;
      error = err.message;
      try {
        const bodyText = document.body?.innerText || "";
        if (/300013|安全限制/.test(bodyText)) {
          error = "[300013] " + (error || "安全限制");
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
        title: note.title ?? null,
        desc: note.desc ?? null,
        type: note.type ?? null,
        url: token ? helper.buildNoteUrl(noteId, token) : `https://www.xiaohongshu.com/explore/${noteId}`,
        author: note.user?.nickname ?? null,
        author_id: note.user?.userId ?? note.user?.user_id ?? null,
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

      metrics.successCount++;
      totalElapsed += elapsed;
      consecutiveFailures = 0;

      // Response time monitoring
      if (elapsed > 5000) {
        consecutiveSlowNotes++;
        metrics.slowNotes++;
        if (consecutiveSlowNotes >= 2) {
          baseDelayMs = Math.min(baseDelayMs * 1.3, maxDelayMs * 2);
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
    remaining: [],
    metrics,
    stopped_reason: "completed"
  };
}
