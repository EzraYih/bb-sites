/* @meta
{
  "name": "xiaohongshu/users-batch",
  "description": "Batch fetch user profiles from xiaohongshu.com (SPA navigation + Pinia store)",
  "domain": "www.xiaohongshu.com",
  "args": {
    "users": {"required": true, "description": "JSON array of {userId}"},
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

  const helper = globalThis.__bbBrowserXhsHelperV2?.fetchViaSPA
    ? globalThis.__bbBrowserXhsHelperV2
    : (globalThis.__bbBrowserXhsHelperV2 = (() => {
    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
    function getGlobals() { var a = getApp(); return a ? a.config.globalProperties : null; }
    function getPinia() { var g = getGlobals(); return g ? g.$pinia : null; }
    function getStore(name) { var p = getPinia(); return p && p._s ? p._s.get(name) : null; }
    function getRouter() { var g = getGlobals(); return g ? g.$router : null; }

    // Condition-based wait: poll predicate until true or timeout
    async function waitFor(predicate, timeoutMs, intervalMs) {
      intervalMs = intervalMs || 300;
      var deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try { var result = await predicate(); if (result) return result; } catch(e) {}
        await sleep(intervalMs);
      }
      return null;
    }

    // SPA navigation: navigate then read from Pinia store (primary method)
    async function fetchViaSPA(userId, timeoutMs) {
      var router = getRouter();
      if (!router) throw new Error("SPA router not available");

      // Clear stale data to force fresh load
      var userStore = getStore("user");
      if (userStore && userStore.userPageData) {
        try { userStore.userPageData = null; } catch(e) {}
      }

      await router.push({ path: "/user/profile/" + encodeURIComponent(userId) });

      // Wait for store to populate (replaces fixed 2s + 5s sleep)
      var pageData = await waitFor(function() {
        var store = getStore("user");
        if (!store || !store.userPageData) return null;
        if (!store.userPageData.basicInfo) return null;
        return store.userPageData;
      }, timeoutMs || 8000, 300);

      // If store didn't auto-populate, try explicit fetch
      if (!pageData) {
        var store2 = getStore("user");
        if (store2 && typeof store2.fetchProfilePageData === "function") {
          try { await store2.fetchProfilePageData(userId); } catch(e) {}
          pageData = await waitFor(function() {
            var s = getStore("user");
            return s && s.userPageData && s.userPageData.basicInfo ? s.userPageData : null;
          }, 5000, 300);
        }
      }

      if (!pageData || !pageData.basicInfo) throw new Error("SPA user data not loaded");
      return pageData;
    }

    function classifyAccountType(verifyInfo) {
      var vType = verifyInfo.redOfficialVerifyType;
      // 0 / null / undefined → 未认证个人号
      // 1 → 企业认证
      // 2 → 个人认证（医生、律师等）
      if (vType === 1) return "enterprise";
      if (vType === 2) return "professional";
      return "personal";
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
        account_type: classifyAccountType(verifyInfo),
        follower_count: parseNumericCount(fansItem ? fansItem.count : null),
        verified: verifyInfo.redOfficialVerifyType === 1 || verifyInfo.redOfficialVerifyType === 2,
        red_id: basicInfo.redId || basicInfo.red_id || null,
        desc: basicInfo.desc || basicInfo.description || null,
        gender: basicInfo.gender !== undefined ? basicInfo.gender : null,
        ip_location: basicInfo.ipLocation || null,
        avatar: basicInfo.images || basicInfo.imageb || null
      };
    }

    return { sleep, getStore, getRouter, waitFor, fetchViaSPA, extractDetail };
  })());

  // SPA 就绪检查（与 notes-batch.js 一致 — 无两阶段重试）
  // prepareDetailTab 已确认 SPA 就绪。此处失败说明 SPA 在批次执行期间崩溃或 Pinia 退化。
  // 不执行 location.href / router.push 自愈 —
  //   location.href 会摧毁 CDP 执行上下文（b8e5fde 已证明）；
  //   router.push 是客户端导航，无法重新初始化 Pinia。
  // 直接返回错误，由工作流层降级并发并整批回退。
  var appReady = await helper.waitFor(function() { return helper.getStore("user"); }, 8000, 300);
  if (!appReady) {
    console.log(JSON.stringify({ type: "progress", stage: "spa_not_ready", done: 0, total: (typeof args.users === "string" ? (JSON.parse(args.users).length) : (args.users || []).length), url: location.href, readyState: document.readyState, hasApp: !!document.querySelector('#app'), hasVueApp: !!document.querySelector('#app')?.__vue_app__, hasPinia: !!document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia, storeNames: Array.from(document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia?._s?.keys?.() || []) }));
    return { error: "SPA not ready", hint: "User store not available" };
  }

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

  var maxFailures = Math.max(1, Number(args.max_failures || 0) || 3);
  var minDelayMs = Math.max(0, Number(args.min_delay_ms || 0) || 2000);
  var maxDelayMs = Math.max(minDelayMs, Number(args.max_delay_ms || 0) || 4000);
  var singleUserTimeoutMs = Math.max(1000, Number(args.single_user_timeout_ms || 0) || 10000);

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
  const baseDelayMs = minDelayMs;
  var totalElapsed = 0;
  var maxElapsedMs = 0;
  var remaining = [];

  for (var i = 0; i < users.length; i++) {

    // ── 300013 会话级安全限制检测 ──
    try {
      var bodyText = document.body?.innerText || "";
      if (/300013|安全限制/.test(bodyText)) {
        remaining = users.slice(i);
        return {
          collected: collected, failures: failures, remaining: remaining,
          metrics: {
            totalNotes: users.length, successCount: collected.length, failureCount: failures.length,
            avgElapsedMs: collected.length > 0 ? Math.round(totalElapsed / collected.length) : 0,
            maxElapsedMs: maxElapsedMs, slowNotes: 0
          },
          stopped_reason: "consecutive_failures",
          hint: "platform limit (300013) detected"
        };
      }
    } catch(e) {}

    var user = users[i];
    var userStart = Date.now();
    var error = null;
    var detail = null;

    // ── SPA navigation + Pinia store (唯一方法) ──
    // Uses router.push so requests carry proper x-s/x-t signatures and Referer
    try {
      // 阶段性 progress 事件：开始获取用户资料
      try {
        console.log(JSON.stringify({__bb_progress: {
          done: i,
          total: users.length,
          userId: user.userId,
          success: null,
          error: null,
          stage: "fetch_profile",
          currentUrl: String(location.href || "")
        }}));
      } catch(e) {}
      var pageData = await helper.fetchViaSPA(user.userId, singleUserTimeoutMs);
      detail = helper.extractDetail(pageData, user.userId, parseNumericCount);
    } catch (spaErr) {
      error = "spa:" + (spaErr.message || "?");
    }

    // ── 300031 早期检测（fetchViaSPA 后）──
    // users-batch 的 fetchViaSPA 封装了 router.push + waitFor，无法在导航后 API 前插入检测。
    // 300031 触发后 fetchViaSPA 因 waitFor 超时抛出错误，此处检测 URL 覆盖 error。
    try {
      var navUrl = String(location.href || "");
      if (navUrl.indexOf("/404") >= 0 || /error_code=300031/.test(navUrl)) {
        failures.push({ user_id: user.userId, error: "[300031] user page unavailable", elapsed_ms: Date.now() - userStart });
        consecutiveFailures++;
        if (consecutiveFailures >= maxFailures) {
          remaining = users.slice(i + 1);
          break;
        }
        var r = helper.getRouter();
        if (r) r.push({ path: "/explore" }).catch(function() {});
        await helper.sleep(2000);
        continue;
      }
    } catch(e) {}

    var userElapsed = Date.now() - userStart;
    if (userElapsed > maxElapsedMs) maxElapsedMs = userElapsed;

    if (detail) {
      detail._diagnostics = { elapsed_ms: userElapsed };
      collected.push(detail);
      consecutiveFailures = 0;
      totalElapsed += userElapsed;
    } else {
      failures.push({ user_id: user.userId, error: error, elapsed_ms: userElapsed });
      consecutiveFailures++;
      if (consecutiveFailures >= maxFailures) {
        remaining = users.slice(i + 1);
        break;
      }
    }

    // Emit progress for streaming consumers
    // 包含完整用户数据（user 字段），以便子进程被 Ctrl+C 杀死时父进程可从 stdout 恢复数据
    try {
      var lastCollectedUser = collected[collected.length - 1];
      console.log(JSON.stringify({__bb_progress: {
        done: i + 1,
        total: users.length,
        userId: user.userId,
        success: !!detail,
        error: error || null,
        collected: collected.length,
        failures: failures.length,
        user: lastCollectedUser || null,
        currentUrl: String(location.href || ""),
        stage: "user_complete"
      }}));
    } catch(e) {}

    // Delay between users
    if (i < users.length - 1) {
      var jitter = Math.random() * baseDelayMs * 0.3;
      await helper.sleep(baseDelayMs + jitter);
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
    stopped_reason: consecutiveFailures >= maxFailures ? "consecutive_failures" : "completed"
  };
}


