/* @meta
{
  "name": "xiaohongshu/comments-close",
  "description": "Close a Xiaohongshu note comment session",
  "domain": "www.xiaohongshu.com",
  "args": {
    "comment_session_id": {"required": true, "description": "Comment session ID"}
  },
  "capabilities": [],
  "readOnly": true
}
*/

async function(args) {
  if (!args.comment_session_id) return { error: "Missing argument: comment_session_id" };
  if (!globalThis.__bbBrowserXhsCommentSessions) {
    globalThis.__bbBrowserXhsCommentSessions = {};
  }
  delete globalThis.__bbBrowserXhsCommentSessions[args.comment_session_id];
  return { closed: true, comment_session_id: args.comment_session_id };
}
