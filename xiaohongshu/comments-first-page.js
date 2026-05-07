/* @meta
{
  "name": "xiaohongshu/comments-first-page",
  "description": "Fetch the first comments page and decide whether it is already complete",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "xsec_token": {"required": false, "description": "Optional xsec token"},
    "top_limit": {"required": false, "description": "Limit for one top-level comments request"},
    "context_warmup_ms": {"required": false, "description": "Extra warmup after entering note context"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comments-first-page 69aa7160000000001b01634d --top_limit 20"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  const resolved = helper.resolveNoteIdentity(args.note_id, args.xsec_token || null);
  if (!resolved.noteId) {
    return helper.errorResult("Invalid note_id", "Pass a note ID or full note URL", "");
  }
  if (!resolved.xsecToken) {
    return helper.errorResult(
      "Missing xsec token for note",
      "Pass the full note URL, provide xsec_token explicitly, or open this note once in the current browser session",
      "",
    );
  }

  function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  function parseNonNegativeInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  function normalizeTopLevelComments(items, topLimit) {
    return (Array.isArray(items) ? items : []).slice(0, topLimit).map((comment) => {
      const commentId = helper.getCommentId(comment);
      const contentText = helper.firstNonEmpty(comment?.content, comment?.text, comment?.desc);
      return helper.normalizeCommentRecord(comment, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: null,
      });
    });
  }

  function normalizeReplyTask(task) {
    const commentId = helper.firstNonEmpty(task?.comment_id, task?.commentId);
    if (!commentId) return null;
    return {
      comment_id: String(commentId),
      sub_comment_count: Math.max(0, Number(task?.sub_comment_count) || 0),
      reply_cursor: helper.firstNonEmpty(task?.reply_cursor, task?.replyCursor) || null,
      reply_page_index: Math.max(1, Number(task?.reply_page_index) || Number(task?.replyPageIndex) || 1),
    };
  }

  function buildReplyTasks(items, topLimit) {
    const tasks = [];
    for (const comment of (Array.isArray(items) ? items : []).slice(0, topLimit)) {
      const commentId = helper.getCommentId(comment);
      if (!commentId) continue;

      const previewReplies = helper.getReplyItems(comment).map((reply) => {
        const contentText = helper.firstNonEmpty(comment?.content, comment?.text, comment?.desc);
        return helper.normalizeCommentRecord(reply, {
          note_id: resolved.noteId,
          note_url: resolved.url,
          root_comment_id: commentId,
          root_comment_content: contentText,
          parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, commentId),
        });
      });
      for (const previewReply of previewReplies) {
        addCommentDelta(commentsDelta, seenCommentIds, previewReply);
      }

      const subCommentCount = Math.max(0, Number(comment?.subCommentCount ?? comment?.sub_comment_count) || 0);
      const replyHasMore = helper.getReplyHasMore(comment);
      const previewCount = previewReplies.length;
      const needsReplyFetch = subCommentCount > 0 && (replyHasMore || subCommentCount > previewCount);
      if (!needsReplyFetch) continue;

      const task = normalizeReplyTask({
        comment_id: commentId,
        sub_comment_count: subCommentCount,
        reply_cursor: replyHasMore ? helper.getReplyCursor(comment) : null,
        reply_page_index: 1,
      });
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  function addCommentDelta(delta, seen, comment) {
    const commentId = helper.firstNonEmpty(comment?.comment_id, comment?.commentId);
    if (!commentId) return;
    const key = String(commentId);
    if (seen.has(key)) return;
    seen.add(key);
    delta.push(comment);
  }

  const topLimit = parsePositiveInt(args.top_limit ?? args.limit, 20);
  const contextWarmupMs = parseNonNegativeInt(args.context_warmup_ms, 0);
  const startedAt = Date.now();
  const commentsDelta = [];
  const seenCommentIds = new Set();

  try {
    await helper.ensureNoteCommentApiContext(resolved.noteId, resolved.xsecToken, {
      warmupMs: contextWarmupMs,
    });

    const page = await helper.fetchWebpackCommentPage(
      resolved.noteId,
      resolved.xsecToken,
      "",
      topLimit,
    );

    for (const comment of normalizeTopLevelComments(page.items, topLimit)) {
      addCommentDelta(commentsDelta, seenCommentIds, comment);
    }

    const replyTasks = buildReplyTasks(page.items, topLimit);
    const nextTopCursor = page.has_more && page.cursor_out ? String(page.cursor_out) : null;
    const isComplete = !nextTopCursor && replyTasks.length === 0;

    return {
      note_id: resolved.noteId,
      note_url: resolved.url,
      count: commentsDelta.length,
      comments: commentsDelta,
      has_more_top_comments: Boolean(nextTopCursor),
      next_top_cursor: nextTopCursor,
      reply_queue_size: replyTasks.length,
      reply_queue_preview: replyTasks.slice(0, 5),
      is_complete: isComplete,
      completion_reason: isComplete ? "single_page_complete" : "needs_chunk_fallback",
      stats: {
        request_count: 1,
        top_pages_fetched: 1,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (helper.isSecurityRestrictionPage() || helper.isSecurityRestrictionError(error)) {
      return helper.buildSecurityRestrictionResult(resolved.url || "https://www.xiaohongshu.com/explore");
    }

    const sessionState = await helper.ensureXiaohongshuSession({ actionUrl: resolved.url || "https://www.xiaohongshu.com/explore" });
    if (!sessionState.ok) return sessionState.result;

    return helper.errorResult(
      error?.message || "Comments first page fetch failed",
      "Failed to fetch the first comments page. Confirm the note is still accessible and the page is not in a restricted state.",
      "",
    );
  }
}
