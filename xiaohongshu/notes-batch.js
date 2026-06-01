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
    "max_delay_ms": {"required": false, "description": "Max delay between notes (default 1200)"}
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
    return {
      sleep,
      getPinia,
      getRouter,
      getStore,
      toPlain,
      waitFor,
      withTimeout,
      normalizeUser,
      mapNoteCardItem,
      parseNoteInput,
      buildNoteUrl,
      rememberNoteTokens,
      resolveNoteToken
    };
  })());

  const pinia = helper.getPinia();
  const userStore = helper.getStore("user");
  if (!userStore?.loggedIn) return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore — then log in manually" };
  if (!pinia?._s) return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };

  // Parse parameters
  let notes;
  try {
    notes = typeof args.notes === "string" ? JSON.parse(args.notes) : args.notes;
    if (!Array.isArray(notes)) return { error: "notes must be an array" };
  } catch (e) {
    return { error: "Invalid JSON in notes parameter", detail: e.message };
  }

  const timeBudgetMs = Number(args.time_budget_ms) || 60000;
  const singleNoteTimeoutMs = Number(args.single_note_timeout_ms) || 8000;
  const maxFailures = Number(args.max_failures) || 3;
  const minDelayMs = Number(args.min_delay_ms) || 600;
  const maxDelayMs = Number(args.max_delay_ms) || 1200;

  const startTime = Date.now();
  const collected = [];
  const failures = [];
  const noteStore = helper.getStore("note");

  // Adaptive delay parameters
  let baseDelayMs = minDelayMs + (maxDelayMs - minDelayMs) / 2;
  let consecutiveSlowNotes = 0;
  let consecutiveFailures = 0;

  // Performance metrics
  const metrics = {
    totalNotes: notes.length,
    successCount: 0,
    failureCount: 0,
    avgElapsedMs: 0,
    maxElapsedMs: 0,
    slowNotes: 0
  };

  let totalElapsed = 0;

  for (let i = 0; i < notes.length; i++) {
    const item = notes[i];
    const noteStartTime = Date.now();

    // Layer 1: Total time budget check
    const elapsedTotal = Date.now() - startTime;
    if (elapsedTotal > timeBudgetMs) {
      const remaining = notes.slice(i);
      return {
        collected,
        failures,
        remaining,
        metrics,
        stopped_reason: "time_budget_exceeded",
        hint: `Reached ${timeBudgetMs}ms time budget after ${i} notes`
      };
    }

    const noteId = item.noteId || item.note_id;
    const xsecToken = item.xsecToken || item.xsec_token || helper.resolveNoteToken(noteId);

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
            }
          }

          // Call internal API
          if (noteStore.getNoteDetailByNoteId) {
            try {
              await noteStore.getNoteDetailByNoteId(noteId);
            } catch {}
          }

          // Wait for data ready
          return await helper.waitFor(() => {
            const current = noteStore.noteDetailMap?.[noteId];
            if (!current?.note || current.note.noteId !== noteId) return null;
            return helper.toPlain(current);
          }, singleNoteTimeoutMs);
        })(),
        singleNoteTimeoutMs,
        `Note ${noteId} timed out after ${singleNoteTimeoutMs}ms`
      );

      elapsed = Date.now() - noteStartTime;

    } catch (err) {
      elapsed = Date.now() - noteStartTime;
      error = err.message;
    }

    // Layer 3: Performance monitoring
    metrics.maxElapsedMs = Math.max(metrics.maxElapsedMs, elapsed);

    if (detail && detail.note) {
      // Success
      const note = detail.note;
      const token = note.xsecToken ?? xsecToken;
      
      helper.rememberNoteTokens([{ id: noteId, xsecToken: token, noteCard: { noteId } }]);

      collected.push({
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
          slow: elapsed > 5000
        }
      });

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
