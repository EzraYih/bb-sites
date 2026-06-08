/* @meta
{
  "name": "xiaohongshu/comments-batch",
  "description": "Batch fetch first-page comments for multiple notes, shared page session",
  "domain": "www.xiaohongshu.com",
  "args": {
    "notes": {"required": true, "description": "JSON array of {noteId, xsecToken}"},
    "time_budget_ms": {"required": false, "description": "Max time for this batch (default 60000)"},
    "single_note_timeout_ms": {"required": false, "description": "Timeout for single note comments (default 15000)"},
    "max_failures": {"required": false, "description": "Max consecutive failures before abort (default 3)"},
    "min_delay_ms": {"required": false, "description": "Min delay between notes (default 1000)"},
    "max_delay_ms": {"required": false, "description": "Max delay between notes (default 2000)"}
  },
  "capabilities": ["network"],
  "readOnly": true
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
    async function waitFor(predicate, timeoutMs = 15000, intervalMs = 250) {
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
    function resolveNoteIdentity(input) {
      if (!input || typeof input !== "string") {
        if (input && typeof input === "object") {
          return { noteId: input.noteId || input.note_id || "", xsecToken: input.xsecToken || input.xsec_token || null, url: null };
        }
        return { noteId: "", xsecToken: null, url: null };
      }
      let raw = String(input).trim();
      let noteId = raw;
      let xsecToken = null;
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
      return { noteId, xsecToken, url: xsecToken ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=` : null };
    }
    function hasCommentLoader(noteStore) {
      return typeof noteStore?.getCommentListByNoteId === "function"
        || typeof noteStore?.getCommentsByNoteId === "function"
        || typeof noteStore?.fetchCommentList === "function"
        || typeof noteStore?.fetchCommentsByNoteId === "function";
    }
    return { sleep, getPinia, getStore, toPlain, waitFor, withTimeout, resolveNoteIdentity, hasCommentLoader };
  })());

  const notes = args.notes;
  const timeBudgetMs = args.time_budget_ms || 60000;
  const singleNoteTimeoutMs = args.single_note_timeout_ms || 15000;
  const maxFailures = args.max_failures || 3;
  const minDelayMs = args.min_delay_ms || 1000;
  const maxDelayMs = args.max_delay_ms || 2000;

  const pinia = helper.getPinia?.();
  if (!pinia?._s) return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };

  const noteStore = helper.getStore("note");
  const userStore = helper.getStore("user");
  if (!userStore?.loggedIn) return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };

  const startTime = Date.now();
  const collected = [];
  const failures = [];
  let consecutiveFailures = 0;
  let totalElapsed = 0;
  const metrics = { totalNotes: notes.length, successCount: 0, failureCount: 0, avgElapsedMs: 0, maxElapsedMs: 0, slowNotes: 0 };

  for (let i = 0; i < notes.length; i++) {
    // Time budget check
    if (Date.now() - startTime > timeBudgetMs) {
      const remaining = notes.slice(i);
      metrics.avgElapsedMs = metrics.successCount > 0 ? Math.round(totalElapsed / metrics.successCount) : 0;
      return { collected, failures, remaining, metrics, stopped_reason: "time_budget_exceeded" };
    }

    const note = notes[i];
    const resolved = helper.resolveNoteIdentity(note);
    const noteId = resolved.noteId;
    const xsecToken = resolved.xsecToken;

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

    const noteStartTime = Date.now();
    let detail = null;
    let error = null;

    try {
      detail = await helper.withTimeout(
        (async () => {
          const router = helper.getRouter();

          // Navigate only if note detail is not already loaded
          if (!noteStore?.noteDetailMap?.[noteId]) {
            if (router) {
              router.push({
                path: `/explore/${noteId}`,
                query: { xsec_token: xsecToken, xsec_source: "" }
              }).catch(() => {});
              await helper.sleep(800);
            }
          }

          // Load comments
          const loadComments = noteStore?.getCommentListByNoteId
            || noteStore?.getCommentsByNoteId
            || noteStore?.fetchCommentList
            || noteStore?.fetchCommentsByNoteId;
          if (typeof loadComments === "function") {
            try {
              await loadComments.call(noteStore, noteId);
            } catch {}
          }

          // Wait for comments data
          return await helper.waitFor(() => {
            const current = noteStore?.noteDetailMap?.[noteId];
            if (!current) return null;
            const comments = current.comments;
            if (!comments) return null;
            const list = Array.isArray(comments.list) ? comments.list : [];
            return helper.toPlain({ comments });
          }, singleNoteTimeoutMs);
        })(),
        singleNoteTimeoutMs,
        `Comments for note ${noteId} timed out after ${singleNoteTimeoutMs}ms`
      );

    } catch (err) {
      error = err.message;
    }

    const elapsed = Date.now() - noteStartTime;
    metrics.maxElapsedMs = Math.max(metrics.maxElapsedMs, elapsed);

    if (detail && detail.comments) {
      const commentsState = detail.comments;
      const list = Array.isArray(commentsState.list) ? commentsState.list : [];
      const mappedComments = list.map((c) => ({
        id: c?.id ?? null,
        author: c?.userInfo?.nickname ?? c?.user_info?.nickname ?? null,
        author_id: c?.userInfo?.userId ?? c?.userInfo?.user_id ?? c?.user_info?.user_id ?? null,
        content: c?.content ?? null,
        likes: c?.likeCount ?? c?.like_count ?? null,
        sub_comment_count: c?.subCommentCount ?? c?.sub_comment_count ?? null,
        created_time: c?.createTime ?? c?.create_time ?? null
      }));

      collected.push({
        note_id: noteId,
        comments: mappedComments,
        cursor: commentsState.cursor ?? null,
        has_more: commentsState.hasMore ?? commentsState.has_more ?? false,
        count: mappedComments.length,
        _diagnostics: { elapsed_ms: elapsed, slow: elapsed > 10000 }
      });

      metrics.successCount++;
      totalElapsed += elapsed;
      consecutiveFailures = 0;

    } else {
      failures.push({
        note_id: noteId,
        error: error || "Comments not loaded",
        elapsed_ms: elapsed
      });
      metrics.failureCount++;
      consecutiveFailures++;

      if (consecutiveFailures >= maxFailures) {
        const remaining = notes.slice(i + 1);
        metrics.avgElapsedMs = metrics.successCount > 0 ? Math.round(totalElapsed / metrics.successCount) : 0;
        return {
          collected, failures, remaining, metrics,
          stopped_reason: "consecutive_failures",
          hint: maxFailures + " consecutive comment failures detected, possible rate limiting"
        };
      }
    }

    // Inter-note delay
    if (i < notes.length - 1) {
      const baseDelay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
      await helper.sleep(baseDelay);
    }
  }

  metrics.avgElapsedMs = metrics.successCount > 0 ? Math.round(totalElapsed / metrics.successCount) : 0;
  return { collected, failures, remaining: [], metrics, stopped_reason: "completed" };
}
