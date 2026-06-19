/* @meta
{
  "name": "xiaohongshu/users-batch",
  "description": "Batch fetch user profiles from xiaohongshu.com (hybrid: fetch+SSR -> SPA+store fallback)",
  "domain": "www.xiaohongshu.com",
  "args": {
    "users": {"required": true, "description": "JSON array of {userId}"},
    "time_budget_ms": {"required": false, "description": "Max time for this batch"},
    "single_user_timeout_ms": {"required": false, "description": "Timeout per user fetch"},
    "max_failures": {"required": false, "description": "Max consecutive failures before abort"},
    "min_delay_ms": {"required": false, "description": "Min delay between users"},
    "max_delay_ms": {"required": false, "description": "Max delay between users"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/users-batch --users [{\"userId\":\"5b16d7ea11be1017c3031b8e\"}]"
}
*/

async function(args) {
  if (!args.users) return { error: "Missing argument: users" };

  const helper = globalThis.__bbBrowserXhsHelperV2?.fetchHtml
    ? globalThis.__bbBrowserXhsHelperV2
    : (globalThis.__bbBrowserXhsHelperV2 = (() => {
    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    async function fetchHtml(url) {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Request failed: " + response.status);
      return await response.text();
    }

    function parseInitialState(html) {
      const match = html.match(/__INITIAL_STATE__=(\{[\s\S]*?\})<\/script>/);
      if (!match) throw new Error("SSR state not found");
      return (0, eval)("(" + match[1] + ")");
    }

    function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
    function getGlobals() { var a = getApp(); return a ? a.config.globalProperties : null; }
    function getPinia() { var g = getGlobals(); return g ? g.$pinia : null; }
    function getStore(name) { var p = getPinia(); return p && p._s ? p._s.get(name) : null; }
    function getRouter() { var g = getGlobals(); return g ? g.$router : null; }

    // SPA fallback: navigate then read from Pinia store
    async function fetchViaSPA(userId) {
      var router = getRouter();
      if (!router) throw new Error("SPA router not available");

      await router.push({ path: "/user/profile/" + encodeURIComponent(userId) });
      await sleep(2000);

      var userStore = getStore("user");
      if (userStore && typeof userStore.fetchProfilePageData === "function") {
        var result = await userStore.fetchProfilePageData(userId);
      }

      await sleep(5000);

      var store2 = getStore("user");
      var pageData = store2 ? store2.userPageData : null;
      if (!pageData || !pageData.basicInfo) throw new Error("SPA user data not loaded");
      return pageData;
    }

    function extractDetail(pageData, userId, parseNumericCount) {
      var basicInfo = pageData.basicInfo || {};
      var verifyInfo = pageData.verifyInfo || {};
      var interactions = Array.isArray(pageData.interactions) ? pageData.interactions : [];
      var fansItem = null;
      for (var fi = 0; fi < interactions.length; fi++) {
        if (interactions[fi].type === "fans") { fansItem = interactions[fi]; break; }
      }
      return {
        user_id: basicInfo.userId || basicInfo.user_id || userId,
        nickname: basicInfo.nickname || null,
        account_type: verifyInfo.redOfficialVerifyType === 1 ? "verified" : "personal",
        follower_count: parseNumericCount(fansItem ? fansItem.count : null),
        verified: verifyInfo.redOfficialVerifyType === 1,
        red_id: basicInfo.redId || basicInfo.red_id || null,
        desc: basicInfo.desc || basicInfo.description || null,
        gender: basicInfo.gender !== undefined ? basicInfo.gender : null,
        ip_location: basicInfo.ipLocation || null,
        avatar: basicInfo.images || basicInfo.imageb || null
      };
    }

    return { sleep, fetchHtml, parseInitialState, getStore, getRouter, fetchViaSPA, extractDetail };
  })());

  var userStore = helper.getStore("user");
  if (userStore && !userStore.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore and log in manually" };
  }

  var users;
  try {
    users = typeof args.users === "string" ? JSON.parse(args.users) : args.users;
  } catch {
    return { error: "Invalid argument: users must be valid JSON" };
  }
  if (!Array.isArray(users) || users.length === 0) {
    return { error: "Invalid argument: users must be a non-empty array" };
  }

  var timeBudgetMs = Math.max(0, Number(args.time_budget_ms || 0) || 60000);
  var maxFailures = Math.max(1, Number(args.max_failures || 0) || 3);
  var minDelayMs = Math.max(0, Number(args.min_delay_ms || 0) || 600);
  var maxDelayMs = Math.max(minDelayMs, Number(args.max_delay_ms || 0) || 1500);

  function parseNumericCount(count) {
    if (typeof count === "number") return count;
    if (!count || typeof count !== "string") return null;
    var clean = count.replace(/[+>]/g, "").trim();
    var m = clean.match(/^([\d.]+)\s*\u4e07?$/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    return clean.indexOf("\u4e07") >= 0 ? Math.round(n * 10000) : Math.round(n);
  }

  var collected = [];
  var failures = [];
  var startedAt = Date.now();
  var consecutiveFailures = 0;
  var baseDelayMs = minDelayMs;
  var totalElapsed = 0;
  var maxElapsedMs = 0;
  var remaining = [];

  for (var i = 0; i < users.length; i++) {
    if (timeBudgetMs > 0 && Date.now() - startedAt >= timeBudgetMs) {
      remaining = users.slice(i);
      break;
    }

    var user = users[i];
    var userStart = Date.now();
    var error = null;
    var detail = null;
    var usedFallback = false;

    // ── Method 1: fetch + SSR parse (fast path) ──
    try {
      var html = await helper.fetchHtml("https://www.xiaohongshu.com/user/profile/" + encodeURIComponent(user.userId));
      var state = helper.parseInitialState(html);
      var upd = state ? state.user : null;
      if (!upd || !upd.userPageData) throw new Error("SSR state missing userPageData");
      detail = helper.extractDetail(upd.userPageData, user.userId, parseNumericCount);
    } catch (fetchErr) {
      // ── Method 2: SPA navigation + Pinia store (fallback) ──
      try {
        var pageData = await helper.fetchViaSPA(user.userId);
        detail = helper.extractDetail(pageData, user.userId, parseNumericCount);
        usedFallback = true;
      } catch (spaErr) {
        error = "fetchSSR:" + (fetchErr.message || "?") + " | spa:" + (spaErr.message || "?");
      }
    }

    var userElapsed = Date.now() - userStart;
    if (userElapsed > maxElapsedMs) maxElapsedMs = userElapsed;

    if (detail) {
      detail._diagnostics = { elapsed_ms: userElapsed, used_fallback: usedFallback };
      collected.push(detail);
      consecutiveFailures = 0;
      totalElapsed += userElapsed;
      // After SPA fallback, reset delay (already waited long enough)
      if (usedFallback) baseDelayMs = minDelayMs;
    } else {
      failures.push({ user_id: user.userId, error: error, elapsed_ms: userElapsed });
      consecutiveFailures++;
      baseDelayMs = Math.min(baseDelayMs * 1.3, maxDelayMs * 2);
      if (consecutiveFailures >= maxFailures) {
        remaining = users.slice(i + 1);
        break;
      }
    }

    // Delay between users (skip long delay after SPA fallback)
    if (i < users.length - 1) {
      if (usedFallback) {
        await helper.sleep(minDelayMs);
      } else {
        var jitter = Math.random() * baseDelayMs * 0.3;
        await helper.sleep(baseDelayMs + jitter);
      }
    }
  }

  return {
    collected: collected,
    failures: failures,
    remaining: remaining,
    metrics: {
      totalNotes: users.length,
      successCount: collected.length,
      failureCount: failures.length,
      avgElapsedMs: collected.length > 0 ? Math.round(totalElapsed / collected.length) : 0,
      maxElapsedMs: maxElapsedMs,
      slowNotes: collected.filter(function(d) { return d._diagnostics.elapsed_ms > 5000; }).length
    },
    stopped_reason: remaining.length > 0
      ? "time_budget_exceeded"
      : consecutiveFailures >= maxFailures ? "consecutive_failures" : "completed"
  };
}


