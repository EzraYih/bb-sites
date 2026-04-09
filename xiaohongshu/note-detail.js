/* @meta
{
  "name": "xiaohongshu/note-detail",
  "description": "Get Xiaohongshu note detail for workflow export",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "xsec_token": {"required": false, "description": "Optional xsec token"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/note-detail 69aa7160000000001b01634d"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

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

  let detail;
  try {
    detail = await helper.openNoteAndWait(resolved.noteId, resolved.xsecToken, false);
  } catch (error) {
    return helper.errorResult(
      error?.message || "Note fetch failed",
      "笔记可能不存在、已删除，或当前会话没有权限访问",
      "",
    );
  }

  const mapped = helper.mapNoteDetail(detail, {
    note_id: resolved.noteId,
    xsec_token: resolved.xsecToken,
  });
  if (!mapped.note_id) {
    return helper.errorResult("Note detail unavailable", "笔记详情 store 没有暴露可用的笔记对象", "");
  }

  helper.rememberNoteTokens([{ id: mapped.note_id, xsecToken: mapped.xsec_token, noteCard: { noteId: mapped.note_id } }]);
  return {
    note_id: mapped.note_id,
    xsec_token: mapped.xsec_token,
    title: mapped.title,
    content_text: mapped.content_text,
    note_type: mapped.note_type,
    tags: mapped.tags,
    note_url: mapped.note_url,
    cover_url: mapped.cover_url,
    avatar_url: mapped.avatar_url,
    author_name: mapped.author_name,
    author_user_id: mapped.author_user_id,
    author_profile_url: mapped.author_profile_url,
    liked_count: mapped.liked_count,
    comment_count: mapped.comment_count,
    collect_count: mapped.collect_count,
    share_count: mapped.share_count,
    published_at: mapped.published_at,
    last_update_time: mapped.last_update_time,
    ip_location: mapped.ip_location,
    image_urls: mapped.image_urls,
    video_urls: mapped.video_urls,
  };
}
