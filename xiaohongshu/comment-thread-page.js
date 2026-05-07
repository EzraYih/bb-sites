/* @meta
{
  "name": "xiaohongshu/comment-thread-page",
  "description": "Fetch a single reply page for one root comment thread",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "root_comment_id": {"required": true, "description": "Root comment ID"},
    "xsec_token": {"required": false, "description": "Optional xsec token"},
    "reply_cursor": {"required": false, "description": "Reply cursor for this root thread"},
    "reply_page_index": {"required": false, "description": "Current reply page index"},
    "reply_limit": {"required": false, "description": "Reply page size"},
    "context_warmup_ms": {"required": false, "description": "Extra warmup after entering note context"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comment-thread-page 69aa7160000000001b01634d --root_comment_id 67e52bd8000000001e03fa5f --reply_page_index 2 --reply_limit 10"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }
  if (!args.root_comment_id) {
    return { error: "Missing argument: root_comment_id", hint: "Pass a root comment ID", action: "" };
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

  const rootCommentId = String(args.root_comment_id || "").trim();
  const replyCursor = typeof args.reply_cursor === "string" ? args.reply_cursor : "";
  const replyPageIndex = parsePositiveInt(args.reply_page_index, 1);
  const replyLimit = parsePositiveInt(args.reply_limit, 10);
  const contextWarmupMs = parseNonNegativeInt(args.context_warmup_ms, 0);
  const startedAt = Date.now();

  try {
    await helper.ensureNoteCommentApiContext(resolved.noteId, resolved.xsecToken, {
      warmupMs: contextWarmupMs,
    });

    const knownRoot = helper.findKnownRootComment(resolved.noteId, rootCommentId);
    const rootContentText = helper.firstNonEmpty(knownRoot?.content, knownRoot?.text, knownRoot?.desc) || null;
    const page = await helper.fetchWebpackReplyPage(
      resolved.noteId,
      rootCommentId,
      resolved.xsecToken,
      replyCursor,
      replyLimit,
    );

    const comments = (Array.isArray(page.items) ? page.items : []).slice(0, replyLimit).map((reply) => (
      helper.normalizeCommentRecord(reply, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: rootCommentId,
        root_comment_content: rootContentText,
        parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, rootCommentId),
      })
    ));

    return {
      note_id: resolved.noteId,
      root_comment_id: rootCommentId,
      count: comments.length,
      comments,
      reply_cursor: page.has_more && page.cursor_out ? String(page.cursor_out) : null,
      reply_page_index: replyPageIndex,
      has_more: Boolean(page.has_more),
      stats: {
        request_count: 1,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (helper.isSecurityRestrictionPage() || helper.isSecurityRestrictionError(error)) {
      return helper.buildSecurityRestrictionResult(resolved.url || "https://www.xiaohongshu.com/explore");
    }

    return helper.errorResult(
      error?.message || "Comment thread page fetch failed",
      "Failed to fetch the next reply page for this root comment thread. Confirm the note is still accessible and the page is not in a restricted state.",
      "",
    );
  }
}
