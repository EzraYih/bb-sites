/* @meta
{
  "name": "xiaohongshu/me",
  "description": "Get current logged-in Xiaohongshu user",
  "domain": "www.xiaohongshu.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true
}
*/

async function(args) {
  // @include ./_shared.js

  const pinia = helper.getPinia();
  if (!pinia?._s) {
    return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  const userStore = helper.getStore("user");
  if (!userStore) {
    return { error: "User store not found", hint: "Ensure xiaohongshu.com is fully loaded" };
  }
  if (!userStore.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };
  }

  const directUser = helper.normalizeUser(userStore.userInfo) || helper.normalizeUser(userStore.userPageData?.basicInfo);
  if (directUser) return directUser;

  const captured = await helper.captureJsonResponse(
    "/user/me",
    async () => {
      if (userStore.getUserInfo) {
        try {
          await helper.withTimeout(userStore.getUserInfo(), 6000, "User info load timed out");
        } catch {}
      } else {
        const feedStore = helper.getStore("feed");
        if (feedStore?.fetchFeeds) {
          try {
            await helper.withTimeout(feedStore.fetchFeeds(), 6000, "Feed preload timed out");
          } catch {}
        }
      }
    },
    { settleMs: 500 },
  );

  const refreshedUser = helper.normalizeUser(userStore.userInfo) || helper.normalizeUser(userStore.userPageData?.basicInfo);
  if (refreshedUser) return refreshedUser;

  const networkUser = helper.normalizeUser(captured?.data ?? captured);
  if (networkUser) return networkUser;

  return {
    error: captured?.msg || "Failed to get user info",
    hint: userStore.loggedIn
      ? "User store is logged in but profile data is not populated yet"
      : "Not logged in?",
  };
}
