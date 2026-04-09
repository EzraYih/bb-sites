/* @meta
{
  "name": "xiaohongshu/user_posts",
  "description": "Get Xiaohongshu user posts",
  "domain": "www.xiaohongshu.com",
  "args": {
    "user_id": {"required": true, "description": "User ID"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/user_posts 5a927d8411be10720ae9e1e4"
}
*/

async function(args) {
  if (!args.user_id) return { error: "Missing argument: user_id" };

  // @include ./_shared.js

  const userStore = helper.getStore("user");
  if (userStore && !userStore.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };
  }

  const userId = String(args.user_id).trim();
  if (!userId) return { error: "Missing argument: user_id" };

  let state;
  try {
    const html = await helper.fetchHtml(`https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`);
    state = helper.parseInitialState(html);
  } catch (error) {
    return {
      error: error?.message || "User posts fetch failed",
      hint: "Profile page could not be loaded with the current login state",
    };
  }

  const noteGroups = Array.isArray(state?.user?.notes) ? state.user.notes : [];
  const activeIndex = state?.user?.activeTab?.index ?? 0;
  const selectedGroup = Array.isArray(noteGroups[activeIndex]) ? noteGroups[activeIndex] : helper.flattenNoteGroups(noteGroups);
  helper.rememberNoteTokens(selectedGroup);
  const notes = selectedGroup
    .map(helper.mapNoteCardItem)
    .filter(Boolean)
    .map((note) => ({
      note_id: note.note_id,
      xsec_token: note.xsec_token,
      title: note.title,
      type: note.type,
      url: note.url,
      author: note.author,
      author_id: note.author_id,
      likes: note.likes,
      time: note.time,
      cover: note.cover,
    }));

  return {
    user_id: userId,
    count: notes.length,
    has_more: state?.user?.noteQueries?.[activeIndex]?.hasMore ?? false,
    notes,
    hint: notes.length === 0 ? state?.user?.userPageData?.userAccountStatus?.toast ?? null : null,
  };
}
