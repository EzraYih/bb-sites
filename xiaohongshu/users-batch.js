/* @meta
{
  "name": "xiaohongshu/users-batch",
  "description": "Batch fetch user profiles via SSR HTML",
  "domain": "www.xiaohongshu.com",
  "args": {
    "user_ids": {"required": true, "description": "JSON array of user IDs"},
    "delay_between_ms": {"required": false, "description": "Delay between each user fetch (default 1000)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/users-batch \"[\\\"id1\\\",\\\"id2\\\"]\""
}
*/

async function(args) {
  if (!args.user_ids) return { error: "Missing argument: user_ids" };

  const helper = globalThis.__bbBrowserXhsHelper?.fetchHtml
    ? globalThis.__bbBrowserXhsHelper
    : (globalThis.__bbBrowserXhsHelper = (() => {
    async function fetchHtml(url) {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return await response.text();
    }
    function parseInitialState(html) {
      const match = html.match(/__INITIAL_STATE__=(\{[\s\S]*?\})<\/script>/);
      if (!match) throw new Error("SSR state not found");
      return (0, eval)("(" + match[1] + ")");
    }
    function getStore(name) {
      const app = document.querySelector("#app")?.__vue_app__ || null;
      const pinia = app?.config?.globalProperties?.$pinia || null;
      return pinia?._s?.get(name) || null;
    }
    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
    return {
      fetchHtml,
      parseInitialState,
      getStore,
      sleep,
    };
  })());

  const userStore = helper.getStore?.("user");
  if (userStore && !userStore.loggedIn) {
    return {
      error: "Not logged in",
      hint: "Run: bb-browser open https://www.xiaohongshu.com/explore and log in manually",
    };
  }

  const userIds = JSON.parse(args.user_ids);
  const delayMs = parseInt(args.delay_between_ms) || 1000;
  const collected = [];
  const failures = [];

  for (let i = 0; i < userIds.length; i++) {
    const userId = String(userIds[i]).trim();
    if (!userId) {
      failures.push({ user_id: userId, error: "Empty user ID" });
      continue;
    }

    try {
      const html = await helper.fetchHtml(
        `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`,
      );
      const state = helper.parseInitialState(html);
      const basicInfo = state?.user?.userPageData?.basicInfo || null;
      const interactions = state?.user?.userPageData?.interactions || null;
      const accountStatus = state?.user?.userPageData?.userAccountStatus || null;

      collected.push({
        user_id: basicInfo?.userId ?? basicInfo?.user_id ?? userId,
        nickname: basicInfo?.nickname ?? basicInfo?.name ?? null,
        profile_url: `https://www.xiaohongshu.com/user/profile/${userId}`,
        follower_count: typeof interactions?.fans === "number" ? interactions.fans : null,
        account_type: typeof basicInfo?.type === "string" ? basicInfo.type : null,
        red_official_verified:
          typeof accountStatus?.officialVerified === "boolean"
            ? accountStatus.officialVerified
            : null,
        red_id: basicInfo?.redId ?? basicInfo?.red_id ?? null,
        desc: basicInfo?.desc ?? basicInfo?.description ?? null,
      });
    } catch (error) {
      failures.push({
        user_id: userId,
        error: error?.message || "User profile fetch failed",
        hint: "SSR state not found or fetch error",
      });
    }

    // Delay between users to avoid rate limiting
    if (i < userIds.length - 1) {
      const jitter = Math.random() * delayMs * 0.3;
      await helper.sleep(delayMs + jitter);
    }
  }

  return { collected, failures };
}
