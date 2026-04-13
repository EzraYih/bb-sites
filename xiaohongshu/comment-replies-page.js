/* @meta
{
  "name": "xiaohongshu/comment-replies-page",
  "description": "Get one page of Xiaohongshu comment replies for workflow export",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "comment_id": {"required": true, "description": "Top-level comment ID"},
    "xsec_token": {"required": false, "description": "Optional xsec token"},
    "cursor": {"required": false, "description": "Cursor for the next replies page"},
    "limit": {"required": false, "description": "Max replies returned from this page"},
    "context_warmup_ms": {"required": false, "description": "Optional extra idle time after opening the note context before the first replies request"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comment-replies-page 69aa7160000000001b01634d 1234567890"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }
  if (!args.comment_id) {
    return { error: "Missing argument: comment_id", hint: "Pass a top-level comment ID", action: "" };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  const requestedCursor = helper.firstNonEmpty(args.cursor);
  const requestedLimit = Math.max(1, Number.parseInt(String(args.limit ?? "100"), 10) || 100);
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

  const rootCommentId = String(args.comment_id).trim();

  function normalizeReplies(rootComment, replies) {
    const rootContent = helper.firstNonEmpty(rootComment?.content, rootComment?.text, rootComment?.desc);
    return (Array.isArray(replies) ? replies : []).slice(0, requestedLimit).map((reply) => helper.normalizeCommentRecord(reply, {
      note_id: resolved.noteId,
      note_url: resolved.url,
      root_comment_id: rootCommentId,
      root_comment_content: rootContent,
      parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, rootCommentId),
    }));
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
      error?.message || "Replies fetch failed",
      "笔记可能不存在、已删除，或当前会话没有权限访问",
      "",
    );
  }

  let page;
  try {
    page = await helper.fetchWebpackReplyPage(
      resolved.noteId,
      rootCommentId,
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
      error?.message || "Replies page load failed",
      requestedCursor
        ? "无法加载指定 cursor 的楼中楼评论页"
        : "无法加载楼中楼评论页，请确认当前页面没有进入安全限制页",
      "",
    );
  }

  const rootComment = helper.findKnownRootComment(resolved.noteId, rootCommentId) || { id: rootCommentId };
  const comments = normalizeReplies(rootComment, page.items);

  return {
    note_id: resolved.noteId,
    note_url: resolved.url,
    comment_id: rootCommentId,
    cursor_in: requestedCursor || null,
    cursor_out: page.cursor_out,
    has_more: page.has_more,
    count: comments.length,
    comments,
  };
}
