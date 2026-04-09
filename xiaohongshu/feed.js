/* @meta
{
  "name": "xiaohongshu/feed",
  "description": "Get Xiaohongshu home feed",
  "domain": "www.xiaohongshu.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true
}
*/

async function(args) {
  // @include ./_shared.js

  const pinia = helper.getPinia();
  const userStore = helper.getStore("user");
  if (!userStore?.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };
  }
  if (!pinia?._s) {
    return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  const feedStore = helper.getStore("feed");
  if (!feedStore) {
    return { error: "Feed store not found", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  let feeds = helper.toPlain(feedStore.feeds || []);
  if (!Array.isArray(feeds) || feeds.length === 0) {
    try {
      await helper.navigate("/explore", undefined, 1800);
    } catch {}
    try {
      if (feedStore.fetchFeeds) {
        await helper.withTimeout(feedStore.fetchFeeds(), 6000, "Feed load timed out");
        await helper.sleep(500);
      }
    } catch {}
    feeds = helper.toPlain(feedStore.feeds || []);
  }

  const notes = (Array.isArray(feeds) ? feeds : [])
    .map(helper.mapNoteCardItem)
    .filter(Boolean);

  helper.rememberNoteTokens(feeds);

  if (notes.length === 0) {
    return {
      error: "Feed data unavailable",
      hint: "Open or refresh the Xiaohongshu home feed, then retry",
    };
  }

  const hasMore = Boolean(feedStore?.query?.cursorScore ?? feedStore?.query?.cursor_score ?? notes.length);
  return { count: notes.length, has_more: hasMore, notes };
}
