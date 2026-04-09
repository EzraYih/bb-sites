/* @meta
{
  "name": "xiaohongshu/note",
  "description": "Get Xiaohongshu note details",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/note 69aa7160000000001b01634d"
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
    detail = await helper.openNoteAndWait(resolved.noteId, resolved.xsecToken, false);
  } catch (error) {
    return {
      error: error?.message || "Note fetch failed",
      hint: "The note may be unavailable, deleted, or restricted",
    };
  }

  const note = detail?.note;
  if (!note) return { error: "Note detail unavailable" };

  const token = note.xsecToken ?? resolved.xsecToken;
  helper.rememberNoteTokens([{ id: resolved.noteId, xsecToken: token, noteCard: { noteId: resolved.noteId } }]);
  return {
    note_id: resolved.noteId,
    xsec_token: token,
    title: note.title ?? null,
    desc: note.desc ?? null,
    type: note.type ?? null,
    url: token ? helper.buildNoteUrl(resolved.noteId, token) : `https://www.xiaohongshu.com/explore/${resolved.noteId}`,
    author: note.user?.nickname ?? null,
    author_id: note.user?.userId ?? note.user?.user_id ?? null,
    likes: note.interactInfo?.likedCount ?? null,
    comments: note.interactInfo?.commentCount ?? null,
    collects: note.interactInfo?.collectedCount ?? null,
    shares: note.interactInfo?.shareCount ?? null,
    tags: Array.isArray(note.tagList) ? note.tagList.map((tag) => tag?.name).filter(Boolean) : [],
    images: Array.isArray(note.imageList)
      ? note.imageList.map((image) => image?.urlDefault ?? image?.urlPre ?? image?.url ?? image?.infoList?.[0]?.url).filter(Boolean)
      : [],
    created_time: note.time ?? null,
    last_update_time: note.lastUpdateTime ?? null,
    ip_location: note.ipLocation ?? null,
  };
}
