/* @meta
{
  "name": "xiaohongshu/comments",
  "description": "Get Xiaohongshu note comments",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comments 69aa7160000000001b01634d"
}
*/

async function(args) {
  if (!args.note_id) return { error: "Missing argument: note_id" };

  // @include ./_shared.js

  const pinia = helper.getPinia();
  const userStore = helper.getStore("user");
  if (!userStore?.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };
  }
  if (!pinia?._s) {
    return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  const resolved = helper.resolveNoteIdentity(args.note_id);
  if (!resolved.noteId) {
    return { error: "Invalid note_id", hint: "Pass a note ID or a full note URL" };
  }
  if (!resolved.xsecToken) {
    return {
      error: "Missing xsec token for note",
      hint: "Pass a full note URL, or search/feed that note first so its token is available in the current page data",
    };
  }

  let detail;
  try {
    detail = await helper.openNoteAndWait(resolved.noteId, resolved.xsecToken, true);
  } catch (error) {
    return {
      error: error?.message || "Comments fetch failed",
      hint: "The note may be unavailable, deleted, or restricted",
    };
  }

  const commentsState = detail?.comments || {};
  helper.rememberNoteTokens([{ id: resolved.noteId, xsecToken: resolved.xsecToken, noteCard: { noteId: resolved.noteId } }]);
  const comments = Array.isArray(commentsState.list)
    ? commentsState.list.map((comment) => ({
        id: comment?.id ?? null,
        author: comment?.userInfo?.nickname ?? comment?.user_info?.nickname ?? null,
        author_id: comment?.userInfo?.userId ?? comment?.userInfo?.user_id ?? comment?.user_info?.user_id ?? null,
        content: comment?.content ?? null,
        likes: comment?.likeCount ?? comment?.like_count ?? null,
        sub_comment_count: comment?.subCommentCount ?? comment?.sub_comment_count ?? null,
        created_time: comment?.createTime ?? comment?.create_time ?? null,
      }))
    : [];

  return {
    note_id: resolved.noteId,
    count: comments.length,
    has_more: commentsState.hasMore ?? commentsState.has_more ?? false,
    cursor: commentsState.cursor ?? null,
    comments,
  };
}
