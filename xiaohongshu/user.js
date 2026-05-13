/* @meta
{
  "name": "xiaohongshu/user",
  "description": "Get Xiaohongshu user profile",
  "domain": "www.xiaohongshu.com",
  "args": {
    "user_id": {"required": true, "description": "User ID"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/user 5a927d8411be10720ae9e1e4"
}
*/

async function(args) {
  if (!args.user_id) return { error: "Missing argument: user_id" };

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
    return {
      fetchHtml,
      parseInitialState,
      getStore,
    };
  })());

  const userStore = helper.getStore?.("user");
  if (userStore && !userStore.loggedIn) {
    return {
      error: "Not logged in",
      hint: "Run: bb-browser open https://www.xiaohongshu.com/explore and log in manually",
    };
  }

  const userId = String(args.user_id).trim();
  if (!userId) {
    return { error: "Missing argument: user_id" };
  }

  let state;
  try {
    const html = await helper.fetchHtml(`https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`);
    state = helper.parseInitialState(html);
  } catch (error) {
    return {
      error: error?.message || "User profile fetch failed",
      hint: "Profile page could not be loaded with the current login state",
    };
  }

  const basicInfo = state?.user?.userPageData?.basicInfo || null;
  const interactions = state?.user?.userPageData?.interactions || null;
  const accountStatus = state?.user?.userPageData?.userAccountStatus || null;

  return {
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
    raw: state?.user?.userPageData ?? null,
  };
}
