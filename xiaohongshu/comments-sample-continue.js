/* @meta
{
  "name": "xiaohongshu/comments-sample-continue",
  "description": "Continue a Xiaohongshu note comment sample session",
  "domain": "www.xiaohongshu.com",
  "args": {
    "comment_session_id": {"required": true, "description": "Comment session ID"},
    "page_size": {"required": false, "description": "Requested page size"}
  },
  "capabilities": ["network"],
  "readOnly": true
}
*/

async function(args) {
  function ensureCommentSessionCache() {
    if (!globalThis.__bbBrowserXhsCommentSessions) {
      globalThis.__bbBrowserXhsCommentSessions = {};
    }
    return globalThis.__bbBrowserXhsCommentSessions;
  }

  function mapCommentList(commentsState) {
    return Array.isArray(commentsState?.list)
      ? commentsState.list.map((comment) => ({
          id: comment?.id ?? null,
          author: comment?.userInfo?.nickname ?? comment?.user_info?.nickname ?? null,
          author_id: comment?.userInfo?.userId ?? comment?.userInfo?.user_id ?? comment?.user_info?.user_id ?? null,
          content: comment?.content ?? null,
          likes: comment?.likeCount ?? comment?.like_count ?? null,
          sub_comment_count: comment?.subCommentCount ?? comment?.sub_comment_count ?? null,
          created_time: comment?.createTime ?? comment?.create_time ?? null
        }))
      : [];
  }

  if (!args.comment_session_id) return { error: "Missing argument: comment_session_id" };
  const session = ensureCommentSessionCache()[args.comment_session_id];
  if (!session) return { error: "Comment session not found", comment_session_id: args.comment_session_id };
  if (typeof session.loadNext === "function") {
    const detail = await session.loadNext();
    const nextState = detail?.comments || session.commentsState || {};
    const nextComments = mapCommentList(nextState);
    session.commentsState = nextState;
    session.cursor = nextState?.cursor ?? null;
    session.hasMore = nextState?.hasMore ?? nextState?.has_more ?? false;
    session.loadedCount = nextComments.length;
  }
  const commentsState = session.commentsState || {};
  const comments = mapCommentList(commentsState);
  return {
    note_id: session.noteId,
    mode: "sample",
    comment_session_id: args.comment_session_id,
    count: comments.length,
    loaded_count: session.loadedCount ?? comments.length,
    has_more: session.hasMore ?? commentsState?.hasMore ?? commentsState?.has_more ?? false,
    cursor: session.cursor ?? commentsState?.cursor ?? null,
    comments
  };
}
