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

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  if (session.user) return session.user;

  const userStore = session.userStore;
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

  const refreshedUser = helper.getLoggedInUser(userStore);
  if (refreshedUser) return refreshedUser;

  const networkUser = helper.normalizeUser(captured?.data ?? captured);
  if (networkUser) return networkUser;

  return {
    error: captured?.msg || "Failed to get user info",
    hint: "用户已登录，但资料还没有完成填充，请稍后重试",
    action: "",
  };
}
