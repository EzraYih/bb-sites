/* @meta
{
  "name": "xiaohongshu/comments-page",
  "description": "Get one page of top-level Xiaohongshu note comments for workflow export",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "xsec_token": {"required": false, "description": "Optional xsec token"},
    "cursor": {"required": false, "description": "Cursor for the next top-level comments page"},
    "limit": {"required": false, "description": "Max comments returned from this page"},
    "context_warmup_ms": {"required": false, "description": "Optional extra idle time after opening the note context before the first comments request"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comments-page 69aa7160000000001b01634d --limit 20"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  const requestedCursor = helper.firstNonEmpty(args.cursor);
  const requestedLimit = Math.max(1, Number.parseInt(String(args.limit ?? "50"), 10) || 50);
  const contextWarmupMs = Math.max(0, Number.parseInt(String(args.context_warmup_ms ?? "0"), 10) || 0);
  const pinia = session.pinia;

  if (!pinia?._s) {
    return helper.errorResult("Page not ready", "请确认小红书页面已经加载完成", "bb-browser refresh");
  }

  const resolved = helper.resolveNoteIdentity(args.note_id, args.xsec_token || null);
  if (!resolved.noteId) {
    return helper.errorResult("Invalid note_id", "Pass a note ID or a full note URL", "");
  }
  if (!resolved.xsecToken) {
    return helper.errorResult(
      "Missing xsec token for note",
      "请传完整笔记链接、显式传 xsec_token，或先在当前浏览器会话里搜索/打开过这篇笔记",
      "bb-browser site xiaohongshu/search <keyword>",
    );
  }

  function normalizeTopLevelComments(items) {
    return (Array.isArray(items) ? items : []).slice(0, requestedLimit).map((comment) => {
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

  function normalizeReplyThreads(items) {
    return (Array.isArray(items) ? items : []).slice(0, requestedLimit).map((comment) => {
      const commentId = helper.getCommentId(comment);
      if (!commentId) return null;

      const contentText = helper.firstNonEmpty(comment?.content, comment?.text, comment?.desc);
      const rootRecord = helper.normalizeCommentRecord(comment, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: null,
      });
      const previewReplies = helper.getReplyItems(comment).map((reply) => helper.normalizeCommentRecord(reply, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, commentId),
      }));
      const subCommentCount = Number(rootRecord.sub_comment_count || 0);
      const replyCursor = helper.getReplyCursor(comment) || null;
      const replyHasMore = helper.getReplyHasMore(comment);

      if (subCommentCount <= 0 && previewReplies.length <= 0 && !replyHasMore) {
        return null;
      }

      return {
        comment_id: commentId,
        sub_comment_count: rootRecord.sub_comment_count,
        reply_cursor: replyCursor,
        reply_has_more: replyHasMore,
        preview_replies: previewReplies,
      };
    }).filter(Boolean);
  }

  try {
    await helper.ensureNoteCommentApiContext(resolved.noteId, resolved.xsecToken, {
      warmupMs: contextWarmupMs,
    });
  } catch (error) {
    if (helper.isSecurityRestrictionPage() || helper.isSecurityRestrictionError(error)) {
      return helper.buildSecurityRestrictionResult(resolved.url || "https://www.xiaohongshu.com/explore");
    }
    const sessionState = await helper.ensureXiaohongshuSession({ actionUrl: resolved.url || "https://www.xiaohongshu.com/explore" });
    if (!sessionState.ok) return sessionState.result;
    return helper.errorResult(
      error?.message || "Comments fetch failed",
      "笔记可能不存在、已删除，或当前会话没有权限访问",
      "",
    );
  }

  let page;
  try {
    page = await helper.fetchWebpackCommentPage(
      resolved.noteId,
      resolved.xsecToken,
      requestedCursor || "",
      requestedLimit,
    );
  } catch (error) {
    if (helper.isSecurityRestrictionPage() || helper.isSecurityRestrictionError(error)) {
      return helper.buildSecurityRestrictionResult(resolved.url || "https://www.xiaohongshu.com/explore");
    }
    const sessionState = await helper.ensureXiaohongshuSession({ actionUrl: resolved.url || "https://www.xiaohongshu.com/explore" });
    if (!sessionState.ok) return sessionState.result;
    return helper.errorResult(
      error?.message || "Comments page load failed",
      requestedCursor
        ? "无法加载指定 cursor 的一级评论页"
        : "无法加载一级评论页，请确认当前页面没有进入安全限制页",
      "",
    );
  }

  const comments = normalizeTopLevelComments(page.items);
  const replyThreads = normalizeReplyThreads(page.items);
  return {
    note_id: resolved.noteId,
    note_url: resolved.url,
    cursor_in: requestedCursor || null,
    cursor_out: page.cursor_out,
    has_more: page.has_more,
    count: comments.length,
    comments,
    reply_threads: replyThreads,
  };
}
