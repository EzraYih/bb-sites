const existingHelper = globalThis.__bbBrowserXhsHelper || {};

globalThis.__bbBrowserXhsHelper = (() => {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getApp() {
    return document.querySelector("#app")?.__vue_app__ || null;
  }

  function getGlobals() {
    return getApp()?.config?.globalProperties || null;
  }

  function getPinia() {
    return getGlobals()?.$pinia || null;
  }

  function getRouter() {
    return getGlobals()?.$router || null;
  }

  function getStore(name) {
    return getPinia()?._s?.get(name) || null;
  }

  function getStoreEntries() {
    const entries = getPinia()?._s?.entries?.();
    return entries ? Array.from(entries) : [];
  }

  function buildOpenAction(url = "https://www.xiaohongshu.com/explore") {
    return `bb-browser open ${url}`;
  }

  function toPlain(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value ?? null;
    }
  }

  async function waitFor(predicate, timeoutMs = 8000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await predicate();
        if (result) return result;
      } catch {}
      await sleep(intervalMs);
    }
    return null;
  }

  function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      sleep(timeoutMs).then(() => {
        throw new Error(message);
      }),
    ]);
  }

  function errorResult(error, hint = "", action = "") {
    return {
      error: String(error || "Unknown error"),
      hint,
      action,
    };
  }

  async function waitForXiaohongshuAppReady(timeoutMs = 12000) {
    return await waitFor(() => {
      const pinia = getPinia();
      const router = getRouter();
      const userStore = pinia?._s?.get("user") || null;
      if (!pinia?._s || !router || !userStore) return null;
      if (document.readyState !== "complete" && document.readyState !== "interactive") return null;
      return { pinia, router, userStore };
    }, timeoutMs, 250);
  }

  function getLoggedInUser(userStore) {
    return normalizeUser(userStore?.userInfo) || normalizeUser(userStore?.userPageData?.basicInfo);
  }

  function getLoginVerificationResult(actionUrl) {
    const href = location.href || "";
    const path = location.pathname || "";
    const title = document.title || "";
    const body = (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
    const markers = ["安全验证", "扫码验证身份", "验证码", "小红书APP", "问题反馈", "已登录该账号"];
    const matched = markers.filter((marker) => href.includes(marker) || title.includes(marker) || body.includes(marker));
    const isCaptchaPage = /\/website-login\/captcha/i.test(path);
    const isLoginErrorPage = /\/website-login\/error/i.test(path);

    if (!isCaptchaPage && !isLoginErrorPage && matched.length < 2) {
      return null;
    }

    const hint = isCaptchaPage
      ? "当前页面是小红书安全验证页，请先在浏览器里完成扫码/验证，然后重试"
      : "请先在浏览器中登录小红书账号，然后重试";

    return errorResult("HTTP 401", hint, buildOpenAction(actionUrl));
  }

  async function ensureXiaohongshuSession(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 12000);
    const actionUrl = firstNonEmpty(options.actionUrl, "https://www.xiaohongshu.com/explore");
    const verificationResult = getLoginVerificationResult(actionUrl);
    if (verificationResult) {
      return {
        ok: false,
        pinia: null,
        router: null,
        userStore: null,
        result: verificationResult,
      };
    }

    const ready = await waitForXiaohongshuAppReady(timeoutMs);
    const verificationAfterWait = getLoginVerificationResult(actionUrl);
    if (verificationAfterWait) {
      return {
        ok: false,
        pinia: ready?.pinia || null,
        router: ready?.router || null,
        userStore: ready?.userStore || null,
        result: verificationAfterWait,
      };
    }

    if (!ready?.pinia?._s || !ready?.userStore) {
      return {
        ok: false,
        pinia: ready?.pinia || null,
        router: ready?.router || null,
        userStore: ready?.userStore || null,
        result: errorResult(
          "Page not ready",
          "小红书页面已打开，但前端状态还没初始化完成，请稍后重试",
          buildOpenAction(actionUrl),
        ),
      };
    }

    const userStore = ready.userStore;
    let currentUser = getLoggedInUser(userStore);
    if (toBoolean(userStore.loggedIn) || currentUser) {
      return { ok: true, pinia: ready.pinia, router: ready.router, userStore, user: currentUser };
    }

    if (typeof userStore.getUserInfo === "function") {
      try {
        await withTimeout(userStore.getUserInfo(), 4000, "User info load timed out");
      } catch {}
    }

    currentUser = getLoggedInUser(userStore);
    if (toBoolean(userStore.loggedIn) || currentUser) {
      return { ok: true, pinia: ready.pinia, router: ready.router, userStore, user: currentUser };
    }

    return {
      ok: false,
      pinia: ready.pinia,
      router: ready.router,
      userStore,
      result: errorResult(
        "HTTP 401",
        "请先在浏览器中登录小红书账号，然后重试",
        buildOpenAction(actionUrl),
      ),
    };
  }

  function getPageSignals() {
    return {
      href: location.href || "",
      path: location.pathname || "",
      title: document.title || "",
      body: (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  }

  function findMatchedMarkers(signals, markers) {
    return markers.filter((marker) => (
      signals.href.includes(marker)
      || signals.title.includes(marker)
      || signals.body.includes(marker)
    ));
  }

  function buildSecurityRestrictionResult(actionUrl) {
    return errorResult(
      "HTTP 429",
      "\u5f53\u524d\u9875\u9762\u89e6\u53d1\u5c0f\u7ea2\u4e66\u5b89\u5168\u9650\u5236\uff0c\u8bbf\u95ee\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\uff0c\u65e0\u9700\u91cd\u65b0\u767b\u5f55",
      buildOpenAction(actionUrl),
    );
  }

  function getSecurityRestrictionResult(actionUrl) {
    const signals = getPageSignals();
    const markers = [
      "\u5b89\u5168\u9650\u5236",
      "\u8bbf\u95ee\u9891\u7e41",
      "\u8bf7\u7a0d\u540e\u518d\u8bd5",
      "300013",
    ];
    const matched = findMatchedMarkers(signals, markers);
    const isSecurityErrorPage = /\/website-login\/error/i.test(signals.path);

    if (!isSecurityErrorPage && matched.length < 2 && !matched.includes("300013")) {
      return null;
    }

    return buildSecurityRestrictionResult(actionUrl);
  }

  function getLoginVerificationResult(actionUrl) {
    const signals = getPageSignals();
    const markers = [
      "\u5b89\u5168\u9a8c\u8bc1",
      "\u626b\u7801\u9a8c\u8bc1\u8eab\u4efd",
      "\u9a8c\u8bc1\u7801",
      "\u5c0f\u7ea2\u4e66APP",
      "\u95ee\u9898\u53cd\u9988",
      "\u5df2\u767b\u5f55\u8be5\u8d26\u53f7",
    ];
    const matched = findMatchedMarkers(signals, markers);
    const isCaptchaPage = /\/website-login\/captcha/i.test(signals.path);

    if (!isCaptchaPage && matched.length < 2) {
      return null;
    }

    const hint = isCaptchaPage
      ? "\u5f53\u524d\u9875\u9762\u662f\u5c0f\u7ea2\u4e66\u5b89\u5168\u9a8c\u8bc1\u9875\uff0c\u8bf7\u5148\u5728\u6d4f\u89c8\u5668\u91cc\u5b8c\u6210\u626b\u7801/\u9a8c\u8bc1\uff0c\u7136\u540e\u91cd\u8bd5"
      : "\u8bf7\u5148\u5728\u6d4f\u89c8\u5668\u4e2d\u767b\u5f55\u5c0f\u7ea2\u4e66\u8d26\u53f7\uff0c\u7136\u540e\u91cd\u8bd5";

    return errorResult("HTTP 401", hint, buildOpenAction(actionUrl));
  }

  function isSecurityRestrictionError(error) {
    const text = [
      error?.message,
      error?.msg,
      error?.response?.data?.msg,
      error?.response?.data?.message,
      error?.responseCode,
      error?.response?.data?.code,
      String(error ?? ""),
    ].filter(Boolean).join(" ");
    const markers = [
      "\u5b89\u5168\u9650\u5236",
      "\u8bbf\u95ee\u9891\u7e41",
      "\u8bf7\u7a0d\u540e\u518d\u8bd5",
      "300013",
      "HTTP 429",
      "security restriction",
    ];
    return markers.some((marker) => text.includes(marker));
  }

  async function ensureXiaohongshuSession(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 12000);
    const actionUrl = firstNonEmpty(options.actionUrl, "https://www.xiaohongshu.com/explore");
    const securityRestrictionResult = getSecurityRestrictionResult(actionUrl);
    if (securityRestrictionResult) {
      return {
        ok: false,
        pinia: null,
        router: null,
        userStore: null,
        result: securityRestrictionResult,
      };
    }

    const verificationResult = getLoginVerificationResult(actionUrl);
    if (verificationResult) {
      return {
        ok: false,
        pinia: null,
        router: null,
        userStore: null,
        result: verificationResult,
      };
    }

    const ready = await waitForXiaohongshuAppReady(timeoutMs);
    const securityRestrictionAfterWait = getSecurityRestrictionResult(actionUrl);
    if (securityRestrictionAfterWait) {
      return {
        ok: false,
        pinia: ready?.pinia || null,
        router: ready?.router || null,
        userStore: ready?.userStore || null,
        result: securityRestrictionAfterWait,
      };
    }

    const verificationAfterWait = getLoginVerificationResult(actionUrl);
    if (verificationAfterWait) {
      return {
        ok: false,
        pinia: ready?.pinia || null,
        router: ready?.router || null,
        userStore: ready?.userStore || null,
        result: verificationAfterWait,
      };
    }

    if (!ready?.pinia?._s || !ready?.userStore) {
      return {
        ok: false,
        pinia: ready?.pinia || null,
        router: ready?.router || null,
        userStore: ready?.userStore || null,
        result: errorResult(
          "Page not ready",
          "\u5c0f\u7ea2\u4e66\u9875\u9762\u5df2\u6253\u5f00\uff0c\u4f46\u524d\u7aef\u72b6\u6001\u8fd8\u6ca1\u521d\u59cb\u5316\u5b8c\u6210\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
          buildOpenAction(actionUrl),
        ),
      };
    }

    const userStore = ready.userStore;
    let currentUser = getLoggedInUser(userStore);
    if (toBoolean(userStore.loggedIn) || currentUser) {
      return { ok: true, pinia: ready.pinia, router: ready.router, userStore, user: currentUser };
    }

    if (typeof userStore.getUserInfo === "function") {
      try {
        await withTimeout(userStore.getUserInfo(), 4000, "User info load timed out");
      } catch {}
    }

    currentUser = getLoggedInUser(userStore);
    if (toBoolean(userStore.loggedIn) || currentUser) {
      return { ok: true, pinia: ready.pinia, router: ready.router, userStore, user: currentUser };
    }

    return {
      ok: false,
      pinia: ready.pinia,
      router: ready.router,
      userStore,
      result: errorResult(
        "HTTP 401",
        "\u8bf7\u5148\u5728\u6d4f\u89c8\u5668\u4e2d\u767b\u5f55\u5c0f\u7ea2\u4e66\u8d26\u53f7\uff0c\u7136\u540e\u91cd\u8bd5",
        buildOpenAction(actionUrl),
      ),
    };
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value == null) continue;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
        continue;
      }
      return value;
    }
    return null;
  }

  function numberOrNull(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (["1", "true", "yes"].includes(lowered)) return true;
      if (["0", "false", "no", ""].includes(lowered)) return false;
    }
    return Boolean(value);
  }

  function normalizeUrl(url) {
    if (typeof url !== "string") return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return null;
  }

  function toIsoTime(value) {
    if (value == null || value === "") return null;
    if (typeof value === "string" && /[a-z]/i.test(value)) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  }

  function uniqueStrings(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      if (typeof item !== "string" || !item) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
    return result;
  }

  function collectUrls(value, matcher, limit = 100, seen = new Set(), result = []) {
    if (result.length >= limit || value == null) return result;
    if (typeof value === "string") {
      const normalized = normalizeUrl(value);
      if (normalized && matcher(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
      return result;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        collectUrls(item, matcher, limit, seen, result);
        if (result.length >= limit) break;
      }
      return result;
    }
    if (typeof value === "object") {
      for (const nested of Object.values(value)) {
        collectUrls(nested, matcher, limit, seen, result);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  function isImageUrl(url) {
    return /\.(png|jpe?g|webp|gif|avif|heic)(\?|$)/i.test(url) || /image|sns-webpic|note-image/i.test(url);
  }

  function isVideoUrl(url) {
    return /\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i.test(url) || /video|stream|vod/i.test(url);
  }

  async function captureJsonResponse(urlMatcher, trigger, options = {}) {
    const timeoutMs = options.timeoutMs ?? 0;
    const settleMs = options.settleMs ?? 0;
    const captureAll = options.captureAll ?? false;
    let captured = captureAll ? [] : null;

    const matches = (url) => {
      const value = String(url ?? "");
      if (!value) return false;
      if (typeof urlMatcher === "function") return Boolean(urlMatcher(value));
      if (urlMatcher instanceof RegExp) return urlMatcher.test(value);
      return value.includes(String(urlMatcher));
    };

    const setCapture = (payload) => {
      if (captureAll) {
        captured.push(payload);
      } else if (!captured) {
        captured = payload;
      }
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origFetch = globalThis.fetch;

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__bbUrl = url;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (matches(this.__bbUrl)) {
        const request = this;
        const origReadyStateChange = request.onreadystatechange;
        request.onreadystatechange = function() {
          if (request.readyState === 4) {
            try {
              setCapture(JSON.parse(request.responseText));
            } catch {}
          }
          if (origReadyStateChange) {
            return origReadyStateChange.apply(this, arguments);
          }
        };
      }
      return origSend.apply(this, arguments);
    };

    globalThis.fetch = async function(resource, init) {
      const response = await origFetch.apply(this, arguments);
      try {
        const url = typeof resource === "string" ? resource : resource?.url;
        if (matches(url)) {
          setCapture(await response.clone().json());
        }
      } catch {}
      return response;
    };

    try {
      await trigger();
      if (timeoutMs > 0) {
        await waitFor(() => (captureAll ? captured.length > 0 : captured), timeoutMs, 200);
      }
      if (settleMs > 0) {
        await sleep(settleMs);
      }
      return captured;
    } finally {
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
      globalThis.fetch = origFetch;
    }
  }

  function buildUserProfileUrl(userId) {
    return userId ? `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(String(userId))}` : null;
  }

  function buildNoteUrl(noteId, xsecToken) {
    if (!noteId) return null;
    const base = `https://www.xiaohongshu.com/explore/${encodeURIComponent(String(noteId))}`;
    return xsecToken
      ? `${base}?xsec_token=${encodeURIComponent(String(xsecToken))}&xsec_source=`
      : base;
  }

  function resolveUserAvatar(user) {
    return firstNonEmpty(
      normalizeUrl(user?.avatar),
      normalizeUrl(user?.avatarUrl),
      normalizeUrl(user?.avatar_url),
      normalizeUrl(user?.images),
      normalizeUrl(user?.image),
      normalizeUrl(user?.photo),
      collectUrls(user, isImageUrl, 1)[0] || null,
    );
  }

  function normalizeUser(user) {
    if (!user || typeof user !== "object") return null;
    const userId = firstNonEmpty(user.userId, user.user_id, user.userid, user.id);
    const userName = firstNonEmpty(user.nickname, user.name, user.nickName);
    const avatarUrl = resolveUserAvatar(user);
    const redId = firstNonEmpty(user.redId, user.red_id, user.redid);
    const desc = firstNonEmpty(user.desc, user.description);
    const result = {
      nickname: userName || null,
      user_name: userName || null,
      red_id: redId || null,
      desc: desc || null,
      gender: firstNonEmpty(user.gender),
      userid: userId ? String(userId) : null,
      user_id: userId ? String(userId) : null,
      url: buildUserProfileUrl(userId),
      user_url: buildUserProfileUrl(userId),
      avatar_url: avatarUrl || null,
    };
    if (!result.user_id && !result.user_name && !result.avatar_url) return null;
    return result;
  }

  function extractImageUrls(source) {
    const candidates = [];
    if (Array.isArray(source)) {
      for (const image of source) {
        candidates.push(
          normalizeUrl(image?.urlDefault),
          normalizeUrl(image?.urlPre),
          normalizeUrl(image?.url),
          normalizeUrl(image?.infoList?.[0]?.url),
          normalizeUrl(image?.urlLarge),
          normalizeUrl(image?.url_large),
        );
      }
    }
    return uniqueStrings([
      ...candidates.filter(Boolean),
      ...collectUrls(source, isImageUrl, 100),
    ]);
  }

  function extractVideoUrls(source) {
    return uniqueStrings(collectUrls(source, isVideoUrl, 50));
  }

  function extractTagNames(note) {
    const tags = [];
    const tagList = Array.isArray(note?.tagList) ? note.tagList : Array.isArray(note?.tag_list) ? note.tag_list : [];
    for (const tag of tagList) {
      const name = firstNonEmpty(tag?.name, tag?.title);
      if (name) tags.push(String(name));
    }
    return uniqueStrings(tags);
  }

  function mapNoteCardItem(item) {
    const card = item?.noteCard || item?.note_card || item;
    if (!card || typeof card !== "object") return null;
    const noteId = firstNonEmpty(item?.id, card.noteId, card.note_id);
    const xsecToken = firstNonEmpty(item?.xsecToken, item?.xsec_token, card.xsecToken, card.xsec_token);
    if (!noteId || !/^[a-f0-9]+$/i.test(String(noteId))) return null;

    const interact = card.interactInfo || card.interact_info || {};
    const user = normalizeUser(card.user || card.author || {});
    const noteUrl = buildNoteUrl(noteId, xsecToken);
    const coverUrl = firstNonEmpty(
      normalizeUrl(card.cover?.urlDefault),
      normalizeUrl(card.cover?.urlPre),
      normalizeUrl(card.cover?.url),
      extractImageUrls(card.imageList)[0] || null,
    );
    const likedCount = numberOrNull(firstNonEmpty(interact.likedCount, interact.liked_count));
    const commentCount = numberOrNull(firstNonEmpty(interact.commentCount, interact.comment_count));
    const collectCount = numberOrNull(firstNonEmpty(interact.collectedCount, interact.collected_count));
    const shareCount = numberOrNull(firstNonEmpty(interact.shareCount, interact.share_count));
    const publishedAt = toIsoTime(firstNonEmpty(card.time, card.lastUpdateTime, card.last_update_time));
    const noteType = firstNonEmpty(card.type, card.noteType, card.note_type);

    return {
      id: String(noteId),
      note_id: String(noteId),
      xsec_token: xsecToken ? String(xsecToken) : null,
      title: firstNonEmpty(card.displayTitle, card.display_title, card.title),
      type: noteType || null,
      note_type: noteType || null,
      url: noteUrl,
      note_url: noteUrl,
      cover: coverUrl || null,
      cover_url: coverUrl || null,
      author: user?.user_name || null,
      author_name: user?.user_name || null,
      author_id: user?.user_id || null,
      author_user_id: user?.user_id || null,
      author_profile_url: user?.user_url || null,
      avatar_url: user?.avatar_url || null,
      likes: likedCount,
      liked_count: likedCount,
      comments: commentCount,
      comment_count: commentCount,
      collects: collectCount,
      collect_count: collectCount,
      shares: shareCount,
      share_count: shareCount,
      time: publishedAt,
      published_at: publishedAt,
    };
  }

  function mapNoteDetail(detail, fallback = {}) {
    const note = detail?.note || detail || {};
    const noteId = firstNonEmpty(
      note?.noteId,
      note?.note_id,
      detail?.noteId,
      detail?.note_id,
      fallback?.note_id,
      fallback?.noteId,
    );
    const xsecToken = firstNonEmpty(note?.xsecToken, note?.xsec_token, fallback?.xsec_token, fallback?.xsecToken);
    const user = normalizeUser(note?.user || note?.author || fallback?.user || {});
    const noteUrl = buildNoteUrl(noteId, xsecToken);
    const imageUrls = extractImageUrls(note?.imageList || note?.images || []);
    const videoUrls = extractVideoUrls(note?.video || note?.videoInfoV2 || note?.video_media || note);
    const coverUrl = firstNonEmpty(
      normalizeUrl(note?.cover?.urlDefault),
      normalizeUrl(note?.cover?.urlPre),
      normalizeUrl(note?.cover?.url),
      imageUrls[0] || null,
      fallback?.cover_url,
    );
    const tags = extractTagNames(note);
    const interact = [
      note?.interactInfo,
      note?.interact_info,
      note?.interact,
      note?.interactionInfo,
      detail?.interactInfo,
      detail?.interact_info,
      detail?.interact,
    ].find((value) => value && typeof value === "object" && Object.keys(value).length > 0) || {};
    const likedCount = numberOrNull(firstNonEmpty(
      interact?.likedCount,
      interact?.likeCount,
      interact?.liked_count,
      note?.likedCount,
      note?.likeCount,
      note?.liked_count,
      fallback?.liked_count,
    ));
    const commentCount = numberOrNull(firstNonEmpty(
      interact?.commentCount,
      interact?.comment_count,
      note?.commentCount,
      note?.comment_count,
      fallback?.comment_count,
    ));
    const collectCount = numberOrNull(firstNonEmpty(
      interact?.collectedCount,
      interact?.collectCount,
      interact?.collected_count,
      note?.collectedCount,
      note?.collectCount,
      note?.collect_count,
      fallback?.collect_count,
    ));
    const shareCount = numberOrNull(firstNonEmpty(
      interact?.shareCount,
      interact?.share_count,
      note?.shareCount,
      note?.share_count,
      fallback?.share_count,
    ));
    const publishedAt = toIsoTime(firstNonEmpty(note?.time, note?.publishTime, note?.publish_time, fallback?.published_at));
    const lastUpdateTime = toIsoTime(firstNonEmpty(note?.lastUpdateTime, note?.last_update_time, fallback?.last_update_time));
    const noteType = firstNonEmpty(note?.type, note?.noteType, note?.note_type, fallback?.note_type);
    const contentText = firstNonEmpty(note?.desc, note?.content, note?.contentText, note?.content_text);

    return {
      note_id: noteId ? String(noteId) : null,
      xsec_token: xsecToken ? String(xsecToken) : null,
      title: firstNonEmpty(note?.title, fallback?.title),
      desc: contentText || null,
      content_text: contentText || null,
      type: noteType || null,
      note_type: noteType || null,
      url: noteUrl,
      note_url: noteUrl,
      cover: coverUrl || null,
      cover_url: coverUrl || null,
      avatar_url: user?.avatar_url || firstNonEmpty(fallback?.avatar_url),
      author: user?.user_name || firstNonEmpty(fallback?.author_name, fallback?.author),
      author_name: user?.user_name || firstNonEmpty(fallback?.author_name, fallback?.author),
      author_id: user?.user_id || firstNonEmpty(fallback?.author_user_id, fallback?.author_id),
      author_user_id: user?.user_id || firstNonEmpty(fallback?.author_user_id, fallback?.author_id),
      author_profile_url: user?.user_url || firstNonEmpty(fallback?.author_profile_url),
      likes: likedCount,
      liked_count: likedCount,
      comments: commentCount,
      comment_count: commentCount,
      collects: collectCount,
      collect_count: collectCount,
      shares: shareCount,
      share_count: shareCount,
      tags,
      images: imageUrls,
      image_urls: imageUrls,
      videos: videoUrls,
      video_urls: videoUrls,
      created_time: publishedAt,
      published_at: publishedAt,
      last_update_time: lastUpdateTime,
      ip_location: firstNonEmpty(note?.ipLocation, note?.ip_location, fallback?.ip_location),
    };
  }

  function flattenNoteGroups(groups) {
    const result = [];
    if (!Array.isArray(groups)) return result;
    for (const group of groups) {
      if (Array.isArray(group)) result.push(...group);
      else if (group) result.push(group);
    }
    return result;
  }

  function parseInitialState(html) {
    const match = html.match(/__INITIAL_STATE__=(\{[\s\S]*?\})<\/script>/);
    if (!match) throw new Error("SSR state not found");
    return (0, eval)(`(${match[1]})`);
  }

  async function fetchHtml(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.text();
  }

  function parseNoteInput(input) {
    const raw = String(input ?? "").trim();
    let noteId = raw;
    let xsecToken = null;
    if (!raw) return { noteId: "", xsecToken: null };
    try {
      const url = new URL(raw, location.origin);
      const match = url.pathname.match(/\/(?:explore|search_result)\/([a-z0-9]+)/i);
      if (match) noteId = match[1];
      xsecToken = url.searchParams.get("xsec_token");
    } catch {}
    const idMatch = raw.match(/(?:explore|search_result)\/([a-z0-9]+)/i);
    if (idMatch) noteId = idMatch[1];
    const tokenMatch = raw.match(/[?&]xsec_token=([^&#]+)/i);
    if (!xsecToken && tokenMatch) {
      try {
        xsecToken = decodeURIComponent(tokenMatch[1]);
      } catch {
        xsecToken = tokenMatch[1];
      }
    }
    return { noteId, xsecToken };
  }

  function getTokenCache() {
    if (!globalThis.__bbBrowserXhsTokenCache) {
      globalThis.__bbBrowserXhsTokenCache = {};
    }
    return globalThis.__bbBrowserXhsTokenCache;
  }

  function rememberNoteTokens(items) {
    const cache = getTokenCache();
    if (!Array.isArray(items)) return cache;
    for (const item of items) {
      const mapped = mapNoteCardItem(item);
      if (mapped?.note_id && mapped.xsec_token) {
        cache[mapped.note_id] = mapped.xsec_token;
      }
    }
    return cache;
  }

  function findTokenInCollection(items, noteId) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      const mapped = mapNoteCardItem(item);
      if (mapped?.note_id === String(noteId) && mapped.xsec_token) {
        return mapped.xsec_token;
      }
    }
    return null;
  }

  function resolveNoteToken(noteId) {
    if (!noteId) return null;
    const cache = getTokenCache();
    if (cache[noteId]) return cache[noteId];
    const detail = getStore("note")?.noteDetailMap?.[noteId];
    const direct = firstNonEmpty(detail?.note?.xsecToken, detail?.note?.xsec_token);
    if (direct) return direct;
    const searchToken = findTokenInCollection(getStore("search")?.feeds, noteId);
    if (searchToken) return searchToken;
    const feedToken = findTokenInCollection(getStore("feed")?.feeds, noteId);
    if (feedToken) return feedToken;
    const userToken = findTokenInCollection(flattenNoteGroups(getStore("user")?.notes), noteId);
    if (userToken) return userToken;
    const anchors = document.querySelectorAll(`a[href*="${noteId}"]`);
    for (const anchor of anchors) {
      const parsed = parseNoteInput(anchor.href || anchor.getAttribute("href") || "");
      if (parsed.noteId === noteId && parsed.xsecToken) return parsed.xsecToken;
    }
    return null;
  }

  function resolveNoteIdentity(input, explicitXsecToken = null) {
    const parsed = parseNoteInput(input);
    const xsecToken = explicitXsecToken || parsed.xsecToken || resolveNoteToken(parsed.noteId);
    return {
      noteId: parsed.noteId,
      xsecToken,
      url: parsed.noteId ? buildNoteUrl(parsed.noteId, xsecToken) : null,
    };
  }

  async function navigate(path, query, waitMs = 1500) {
    const router = getRouter();
    if (!router) throw new Error("Router not found");
    router.push({ path, query }).catch(() => {});
    await sleep(waitMs);
    return router.currentRoute?.value || null;
  }

  function getRouteNoteId() {
    const route = getRouter()?.currentRoute?.value || null;
    const routePath = typeof route?.path === "string" ? route.path : "";
    const routeFullPath = typeof route?.fullPath === "string" ? route.fullPath : "";
    const candidate = firstNonEmpty(routePath, routeFullPath);
    const match = candidate.match(/\/explore\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  function getNoteDetail(noteId) {
    return getStore("note")?.noteDetailMap?.[noteId] || null;
  }

  function getCommentsState(noteId) {
    return getNoteDetail(noteId)?.comments || null;
  }

  function getTopLevelComments(noteId) {
    const state = getCommentsState(noteId);
    return Array.isArray(state?.list) ? state.list : [];
  }

  function findRootComment(noteId, commentId) {
    return getTopLevelComments(noteId).find((item) => String(item?.id ?? "") === String(commentId)) || null;
  }

  function getCommentCache() {
    if (!globalThis.__bbBrowserXhsCommentCache) {
      globalThis.__bbBrowserXhsCommentCache = {};
    }
    return globalThis.__bbBrowserXhsCommentCache;
  }

  function getCommentApiContextCache() {
    if (!globalThis.__bbBrowserXhsCommentApiContextCache) {
      globalThis.__bbBrowserXhsCommentApiContextCache = {};
    }
    return globalThis.__bbBrowserXhsCommentApiContextCache;
  }

  function getCachedCommentApiContext(noteId) {
    if (!noteId) return null;
    return getCommentApiContextCache()[String(noteId)] || null;
  }

  function rememberCommentApiContext(noteId, xsecToken, extra = {}) {
    if (!noteId) return null;
    const cache = getCommentApiContextCache();
    const key = String(noteId);
    const next = {
      note_id: key,
      xsec_token: xsecToken ? String(xsecToken) : null,
      warmed_at: new Date().toISOString(),
      path: location.pathname || "",
      href: location.href || "",
      ...extra,
    };
    cache[key] = next;
    return next;
  }

  function getNoteCommentCache(noteId) {
    const cache = getCommentCache();
    const key = noteId ? String(noteId) : "";
    if (!key) return {};
    if (!cache[key]) {
      cache[key] = {};
    }
    return cache[key];
  }

  function dedupeCommentsById(items) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const commentId = getCommentId(item);
      if (!commentId || seen.has(commentId)) continue;
      seen.add(commentId);
      result.push(item);
    }
    return result;
  }

  function rememberRootComments(noteId, items) {
    const bucket = getNoteCommentCache(noteId);
    for (const item of Array.isArray(items) ? items : []) {
      const commentId = getCommentId(item);
      if (!commentId) continue;
      const current = bucket[commentId] || {};
      const next = toPlain(item) || item;
      const preservedReplies = getReplyItems(current);
      const incomingReplies = getReplyItems(next);
      bucket[commentId] = {
        ...current,
        ...next,
        subComments: dedupeCommentsById([...preservedReplies, ...incomingReplies]),
      };
    }
    return bucket;
  }

  function findRememberedRootComment(noteId, commentId) {
    const bucket = getNoteCommentCache(noteId);
    return bucket?.[String(commentId)] || null;
  }

  function rememberReplyPage(noteId, rootCommentId, items, cursorOut = null, hasMore = null) {
    if (!rootCommentId) return null;
    const bucket = getNoteCommentCache(noteId);
    const key = String(rootCommentId);
    const current = bucket[key] || { id: key };
    bucket[key] = {
      ...current,
      subComments: dedupeCommentsById([...getReplyItems(current), ...items.map((item) => toPlain(item) || item)]),
      subCommentCursor: cursorOut ?? current.subCommentCursor ?? null,
      subCommentHasMore: hasMore == null ? current.subCommentHasMore ?? false : Boolean(hasMore),
    };
    return bucket[key];
  }

  function findKnownRootComment(noteId, commentId) {
    return findRootComment(noteId, commentId) || findRememberedRootComment(noteId, commentId);
  }

  function getReplyItems(rootComment) {
    const candidates = [
      rootComment?.subComments,
      rootComment?.sub_comments,
      rootComment?.subCommentList,
      rootComment?.sub_comment_list,
      rootComment?.children,
      rootComment?.replies,
    ];
    const list = candidates.find(Array.isArray);
    return Array.isArray(list) ? list : [];
  }

  function getReplyCursor(rootComment) {
    return firstNonEmpty(
      rootComment?.subCommentCursor,
      rootComment?.sub_comment_cursor,
      rootComment?.cursor,
    );
  }

  function getReplyHasMore(rootComment) {
    return toBoolean(firstNonEmpty(
      rootComment?.hasMoreSubComments,
      rootComment?.has_more_sub_comments,
      rootComment?.hasMore,
      rootComment?.has_more,
    ));
  }

  function getCurrentNoteIdFromLocation() {
    const match = (location.pathname || "").match(/\/explore\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  function getNoteDetailEntry(noteStore, noteId) {
    if (!noteStore || !noteId) return null;
    const current = noteStore.noteDetailMap?.[noteId];
    if (!current?.note || current.note.noteId !== noteId) return null;
    return current;
  }

  function hasQuickNoteDetailContent(detail) {
    if (!detail?.note) return false;
    return Boolean(
      firstNonEmpty(
        detail.note.title,
        detail.note.desc,
        detail.note.content,
        detail.note.user?.nickname,
        detail.note.user?.nickName,
        detail.note.cover?.urlDefault,
        detail.note.imageList?.[0]?.urlDefault,
        detail.note.imagesList?.[0]?.urlDefault,
        detail.note.video?.media?.stream?.h264?.[0]?.masterUrl,
        detail.note.video?.media?.stream?.h265?.[0]?.masterUrl,
      ),
    );
  }

  function getReadyNoteDetailEntry(noteStore, noteId, requireComments = false, quickOnly = false) {
    const current = getNoteDetailEntry(noteStore, noteId);
    if (!current) return null;
    if (!hasQuickNoteDetailContent(current) && !quickOnly) return null;
    if (!requireComments) return current;
    if (hasLoadedNoteComments(current)) {
      rememberRootComments(noteId, current.comments?.list || []);
      return current;
    }
    return quickOnly ? current : null;
  }

  function hasLoadedNoteComments(detail) {
    if (!detail) return false;
    const commentsState = detail.comments;
    if (!commentsState) return false;
    const list = commentsState.list;
    if (Array.isArray(list) && list.length > 0) {
      return true;
    }
    return toBoolean(commentsState.firstRequestFinish);
  }

  function canReuseCurrentNoteContext(noteStore, noteId, requireComments = false) {
    const currentPathNoteId = getCurrentNoteIdFromLocation();
    const currentRouteNoteId = getRouteNoteId();
    const currentStoreNoteId = firstNonEmpty(
      noteStore?.currentNoteId,
      noteStore?.noteId,
      noteStore?.currentNote?.noteId,
      currentRouteNoteId,
      currentPathNoteId,
    );
    const detail = getNoteDetailEntry(noteStore, noteId);
    const sameContext = currentStoreNoteId && String(currentStoreNoteId) === String(noteId);
    if (!sameContext && !detail) {
      return false;
    }
    if (!detail) return false;
    if (!requireComments) return true;
    return hasLoadedNoteComments(detail);
  }

  async function waitForNoteRoute(noteId, timeoutMs = 2500, intervalMs = 100) {
    return await waitFor(() => {
      const currentPathNoteId = getCurrentNoteIdFromLocation();
      const currentRouteNoteId = getRouteNoteId();
      const currentStoreNoteId = firstNonEmpty(
        getStore("note")?.currentNoteId,
        getStore("note")?.noteId,
        getStore("note")?.currentNote?.noteId,
      );
      const matched = firstNonEmpty(currentStoreNoteId, currentRouteNoteId, currentPathNoteId);
      return matched && String(matched) === String(noteId) ? true : null;
    }, timeoutMs, intervalMs);
  }

  async function openNoteAndWait(noteId, xsecToken, requireComments = false) {
    if (!noteId || !xsecToken) throw new Error("Missing note id or xsec token");
    const noteStore = getStore("note");
    if (!noteStore) throw new Error("Note store not found");
    const reusedCurrentContext = canReuseCurrentNoteContext(noteStore, noteId, requireComments);
    const immediateDetail = getReadyNoteDetailEntry(noteStore, noteId, requireComments, true);
    if (reusedCurrentContext && immediateDetail) {
      return immediateDetail;
    }
    if (!reusedCurrentContext) {
      await navigate(`/explore/${noteId}`, { xsec_token: xsecToken, xsec_source: "" }, 350);
      await waitForNoteRoute(noteId, 2500, 100);
    }
    if (noteStore.setCurrentNoteId) noteStore.setCurrentNoteId(noteId);
    const currentDetail = getReadyNoteDetailEntry(noteStore, noteId, requireComments, true);
    if (currentDetail && (!requireComments || hasLoadedNoteComments(currentDetail))) {
      return currentDetail;
    }
    if (noteStore.getNoteDetailByNoteId) {
      try {
        await withTimeout(noteStore.getNoteDetailByNoteId(noteId), 6000, "Note detail load timed out");
      } catch {}
    }
    const detail = await waitFor(() => {
      const ready = getReadyNoteDetailEntry(noteStore, noteId, requireComments, false);
      if (ready) return ready;
      if (!requireComments) {
        return getReadyNoteDetailEntry(noteStore, noteId, false, true);
      }
      return null;
    }, requireComments ? 12000 : 8000, 120);
    if (!detail) {
      throw new Error(requireComments ? "Note comments not loaded" : "Note detail not loaded");
    }
    return detail;
  }

  async function ensureNoteCommentApiContext(noteId, xsecToken, options = {}) {
    if (!noteId || !xsecToken) throw new Error("Missing note id or xsec token");
    const noteStore = getStore("note");
    if (!noteStore) throw new Error("Note store not found");

    const currentContextReusable = canReuseCurrentNoteContext(noteStore, noteId, false);
    const immediateDetail = getReadyNoteDetailEntry(noteStore, noteId, false, true);
    const cachedContext = getCachedCommentApiContext(noteId);
    const cacheMatches = cachedContext
      && cachedContext.note_id === String(noteId)
      && cachedContext.xsec_token === String(xsecToken)
      && currentContextReusable;

    if (cacheMatches) {
      return {
        detail: getNoteDetailEntry(noteStore, noteId),
        reused: true,
        warmed: false,
        cache: cachedContext,
      };
    }

    if (currentContextReusable && immediateDetail) {
      const cache = rememberCommentApiContext(noteId, xsecToken);
      return {
        detail: immediateDetail,
        reused: true,
        warmed: false,
        cache,
      };
    }

    const detail = await openNoteAndWait(noteId, xsecToken, false);
    const cache = rememberCommentApiContext(noteId, xsecToken);
    const warmupMs = Math.max(0, Number(options.warmupMs) || 0);
    if (warmupMs > 0) {
      await sleep(warmupMs);
    }
    return {
      detail,
      reused: false,
      warmed: true,
      cache,
    };
  }

  /*
  function isSecurityRestrictionPage() {
    const href = location.href || "";
    const path = location.pathname || "";
    const title = document.title || "";
    const body = (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
    const markers = ["安全限制", "访问频繁", "请稍后再试", "300013", "安全验证", "扫码验证身份"];
    const matched = markers.filter((marker) => href.includes(marker) || title.includes(marker) || body.includes(marker));
    return /\/website-login\/(error|captcha)/i.test(path) || matched.length >= 2 || matched.includes("300013");
  }

  */
  function isSecurityRestrictionPage() {
    return Boolean(getSecurityRestrictionResult("https://www.xiaohongshu.com/explore"));
  }

  function getWebpackRequire() {
    let req = globalThis.__bbReq || null;
    if (req) return req;
    const chunk = globalThis.webpackChunkxhs_pc_web;
    if (!Array.isArray(chunk)) return null;
    try {
      chunk.push([[Symbol("bb")], {}, (__webpack_require__) => {
        globalThis.__bbReq = __webpack_require__;
      }]);
    } catch {}
    return globalThis.__bbReq || null;
  }

  function getWebpackExportByNames(exportsObject, names = [], sourceHints = []) {
    const candidates = [];
    if (exportsObject) {
      candidates.push(exportsObject);
      if (exportsObject.default && exportsObject.default !== exportsObject) {
        candidates.push(exportsObject.default);
      }
    }

    for (const candidate of candidates) {
      if (typeof candidate === "function") {
        const name = firstNonEmpty(candidate.name, candidate.displayName);
        const source = String(candidate);
        if (names.includes(name) || sourceHints.some((hint) => source.includes(hint))) {
          return candidate;
        }
      }
      if (!candidate || typeof candidate !== "object") continue;
      for (const value of Object.values(candidate)) {
        if (typeof value !== "function") continue;
        const name = firstNonEmpty(value.name, value.displayName);
        const source = String(value);
        if (names.includes(name) || sourceHints.some((hint) => source.includes(hint))) {
          return value;
        }
      }
    }
    return null;
  }

  function getWebpackCommentApi() {
    const req = getWebpackRequire();
    if (!req) {
      throw new Error("Webpack runtime unavailable");
    }

    let commentPage = null;
    let replyPage = null;

    const inspectExports = (exportsObject) => {
      if (!commentPage) {
        commentPage = getWebpackExportByNames(
          exportsObject,
          ["getApiSnsWebV2CommentPage"],
          ["/api/sns/web/v2/comment/page"],
        );
      }
      if (!replyPage) {
        replyPage = getWebpackExportByNames(
          exportsObject,
          ["getApiSnsWebV2CommentSubPage"],
          ["/api/sns/web/v2/comment/sub/page"],
        );
      }
      return commentPage && replyPage;
    };

    try {
      if (inspectExports(req(40122))) {
        return { commentPage, replyPage };
      }
    } catch {}

    for (const cached of Object.values(req.c || {})) {
      if (inspectExports(cached?.exports)) {
        return { commentPage, replyPage };
      }
    }

    for (const [moduleId, factory] of Object.entries(req.m || {})) {
      const source = String(factory);
      if (!source.includes("/api/sns/web/v2/comment/page") && !source.includes("/api/sns/web/v2/comment/sub/page")) {
        continue;
      }
      try {
        if (inspectExports(req(moduleId))) {
          return { commentPage, replyPage };
        }
      } catch {}
    }

    throw new Error("Xiaohongshu comment webpack API not found");
  }

  function normalizeWebpackApiError(error) {
    const message = firstNonEmpty(
      error?.message,
      error?.msg,
      error?.response?.data?.msg,
      error?.response?.data?.message,
      String(error),
    );
    const status = firstNonEmpty(error?.status, error?.response?.status);
    const responseCode = firstNonEmpty(error?.responseCode, error?.response?.data?.code, error?.code);
    const parts = [message];
    if (status != null) parts.push(`status=${status}`);
    if (responseCode != null) parts.push(`code=${responseCode}`);
    return new Error(parts.join(" | "));
  }

  async function callWebpackApi(executor) {
    if (isSecurityRestrictionPage()) {
      throw new Error("Xiaohongshu security restriction page detected (300013)");
    }
    try {
      const result = await executor();
      return toPlain(result) || result;
    } catch (error) {
      throw normalizeWebpackApiError(error);
    }
  }

  async function fetchWebpackCommentPage(noteId, xsecToken, cursor = "", limit = null) {
    const api = getWebpackCommentApi();
    const params = {
      noteId: String(noteId || ""),
      cursor: String(cursor || ""),
      topCommentId: "",
      imageFormats: "",
      xsecToken: String(xsecToken || ""),
    };
    const numericLimit = numberOrNull(limit);
    if (numericLimit) {
      params.num = numericLimit;
    }
    const payload = await callWebpackApi(() => api.commentPage({ params }));
    const normalized = extractCommentListPayload(payload);
    rememberRootComments(noteId, normalized.items);
    return normalized;
  }

  async function fetchWebpackReplyPage(noteId, rootCommentId, xsecToken, cursor = "", limit = null) {
    const api = getWebpackCommentApi();
    const params = {
      noteId: String(noteId || ""),
      rootCommentId: String(rootCommentId || ""),
      num: numberOrNull(limit) || 10,
      cursor: String(cursor || ""),
      topCommentId: "",
      imageFormats: "",
      xsecToken: String(xsecToken || ""),
    };
    const payload = await callWebpackApi(() => api.replyPage({ params }));
    const normalized = extractReplyListPayload(payload);
    rememberReplyPage(noteId, rootCommentId, normalized.items, normalized.cursor_out, normalized.has_more);
    return normalized;
  }

  function getActionNames(store) {
    const result = [];
    if (!store) return result;
    for (const key of Object.keys(store)) {
      try {
        if (typeof store[key] === "function" && !key.startsWith("$") && !key.startsWith("_")) {
          result.push(key);
        }
      } catch {}
    }
    return result;
  }

  function findActionNames(store, includePatterns, excludePatterns = []) {
    return getActionNames(store).filter((name) => {
      const lower = name.toLowerCase();
      return includePatterns.every((pattern) => lower.includes(pattern))
        && excludePatterns.every((pattern) => !lower.includes(pattern));
    });
  }

  function findStoreActions(includePatterns, excludePatterns = []) {
    return getStoreEntries()
      .map(([storeName, store]) => ({
        storeName,
        store,
        actionNames: findActionNames(store, includePatterns, excludePatterns),
      }))
      .filter((entry) => entry.actionNames.length > 0);
  }

  async function tryInvokeAction(store, actionNames, buildArgs, checkLoaded, timeoutMs = 5000) {
    for (const actionName of actionNames) {
      const action = store?.[actionName];
      if (typeof action !== "function") continue;
      for (const buildArg of buildArgs) {
        try {
          const before = checkLoaded.snapshot ? checkLoaded.snapshot() : null;
          const args = buildArg(actionName);
          const callArgs = Array.isArray(args) ? args : [args];
          const result = action.apply(store, callArgs);
          if (result && typeof result.then === "function") {
            try {
              await withTimeout(result, timeoutMs, `Action ${actionName} timed out`);
            } catch {}
          }
          const loaded = await waitFor(() => checkLoaded.check(before), timeoutMs, 200);
          if (loaded) {
            return {
              action_name: actionName,
              data: loaded,
            };
          }
        } catch {}
      }
    }
    return null;
  }

  async function tryInvokeStoreActions(storeActions, buildArgs, checkLoaded, timeoutMs = 5000) {
    for (const group of storeActions) {
      const result = await tryInvokeAction(group.store, group.actionNames, buildArgs, checkLoaded, timeoutMs);
      if (result) {
        return {
          ...result,
          store_name: group.storeName,
        };
      }
    }
    return null;
  }

  function extractCommentImageUrls(comment) {
    const sources = [
      comment?.imageList,
      comment?.images,
      comment?.pictures,
      comment?.pictureList,
      comment?.picture_list,
      comment?.imageInfoList,
      comment?.image_info_list,
      comment?.contentPictures,
      comment?.content_pictures,
      comment?.contentImages,
      comment?.content_images,
    ];
    return uniqueStrings(sources.flatMap((source) => extractImageUrls(source || [])));
  }

  function getCommentId(comment) {
    const commentId = firstNonEmpty(comment?.id, comment?.commentId, comment?.comment_id);
    return commentId ? String(commentId) : null;
  }

  function getCommentIds(items) {
    return Array.isArray(items) ? items.map(getCommentId).filter(Boolean) : [];
  }

  function extractArrayCandidates(container, names) {
    for (const name of names) {
      if (Array.isArray(container?.[name])) {
        return container[name];
      }
    }
    return [];
  }

  function extractCommentListPayload(payload) {
    const candidates = [payload?.data, payload?.comments, payload];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const items = extractArrayCandidates(candidate, ["comments", "commentList", "comment_list", "list", "data"]);
      const cursorOut = firstNonEmpty(candidate?.cursor, candidate?.endCursor, candidate?.end_cursor, candidate?.nextCursor, candidate?.next_cursor);
      const hasMoreRaw = firstNonEmpty(candidate?.hasMore, candidate?.has_more, candidate?.more);
      if (items.length > 0 || cursorOut != null || hasMoreRaw != null) {
        return {
          items,
          cursor_out: cursorOut ?? null,
          has_more: toBoolean(hasMoreRaw),
        };
      }
    }
    return { items: [], cursor_out: null, has_more: false };
  }

  function extractReplyListPayload(payload) {
    const candidates = [payload?.data, payload?.reply, payload];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const items = extractArrayCandidates(candidate, [
        "subComments",
        "sub_comments",
        "subCommentList",
        "sub_comment_list",
        "replies",
        "children",
        "comments",
        "commentList",
        "comment_list",
        "list",
      ]);
      const cursorOut = firstNonEmpty(
        candidate?.cursor,
        candidate?.subCommentCursor,
        candidate?.sub_comment_cursor,
        candidate?.endCursor,
        candidate?.end_cursor,
        candidate?.nextCursor,
        candidate?.next_cursor,
      );
      const hasMoreRaw = firstNonEmpty(
        candidate?.hasMoreSubComments,
        candidate?.has_more_sub_comments,
        candidate?.hasMore,
        candidate?.has_more,
        candidate?.more,
      );
      if (items.length > 0 || cursorOut != null || hasMoreRaw != null) {
        return {
          items,
          cursor_out: cursorOut ?? null,
          has_more: toBoolean(hasMoreRaw),
        };
      }
    }
    return { items: [], cursor_out: null, has_more: false };
  }

  function normalizeCommentRecord(comment, context = {}) {
    const user = normalizeUser(comment?.userInfo || comment?.user_info || comment?.user || {});
    const commentId = getCommentId(comment);
    const contentText = firstNonEmpty(comment?.content, comment?.text, comment?.desc);
    const quotedComment = comment?.targetComment || comment?.target_comment || comment?.replyComment || comment?.reply_comment || null;
    const rootCommentId = firstNonEmpty(context.root_comment_id, context.rootCommentId, commentId);
    const rootCommentContent = firstNonEmpty(
      context.root_comment_content,
      context.rootCommentContent,
      rootCommentId === commentId ? contentText : null,
    );
    const parentCommentId = firstNonEmpty(
      context.parent_comment_id,
      context.parentCommentId,
      comment?.parentCommentId,
      comment?.parent_comment_id,
      rootCommentId === commentId ? null : rootCommentId,
    );
    const quotedCommentId = firstNonEmpty(quotedComment?.id, quotedComment?.commentId, quotedComment?.comment_id);
    const quotedCommentContent = firstNonEmpty(
      quotedComment?.content,
      quotedComment?.text,
      quotedCommentId && String(quotedCommentId) === String(rootCommentId) ? rootCommentContent : null,
    );
    return {
      comment_id: commentId,
      content_text: contentText || null,
      image_urls: extractCommentImageUrls(comment),
      liked_count: numberOrNull(firstNonEmpty(comment?.likeCount, comment?.like_count)),
      comment_time: toIsoTime(firstNonEmpty(comment?.createTime, comment?.create_time, comment?.time)),
      ip_location: firstNonEmpty(comment?.ipLocation, comment?.ip_location),
      sub_comment_count: numberOrNull(firstNonEmpty(comment?.subCommentCount, comment?.sub_comment_count)),
      note_id: context.note_id ? String(context.note_id) : null,
      note_url: context.note_url || null,
      user_id: user?.user_id || null,
      user_url: user?.user_url || null,
      user_name: user?.user_name || null,
      parent_comment_id: parentCommentId ? String(parentCommentId) : null,
      root_comment_id: rootCommentId ? String(rootCommentId) : null,
      root_comment_content: rootCommentContent || null,
      quoted_comment_id: quotedCommentId ? String(quotedCommentId) : null,
      quoted_comment_content: quotedCommentContent || null,
    };
  }

  return {
    ...existingHelper,
    sleep,
    getApp,
    getGlobals,
    getPinia,
    getRouter,
    getStore,
    getStoreEntries,
    buildOpenAction,
    toPlain,
    waitFor,
    withTimeout,
    errorResult,
    waitForXiaohongshuAppReady,
    getLoggedInUser,
    buildSecurityRestrictionResult,
    getSecurityRestrictionResult,
    isSecurityRestrictionError,
    ensureXiaohongshuSession,
    firstNonEmpty,
    numberOrNull,
    toBoolean,
    normalizeUrl,
    toIsoTime,
    uniqueStrings,
    collectUrls,
    isImageUrl,
    isVideoUrl,
    captureJsonResponse,
    buildUserProfileUrl,
    buildNoteUrl,
    resolveUserAvatar,
    normalizeUser,
    extractImageUrls,
    extractVideoUrls,
    extractTagNames,
    mapNoteCardItem,
    mapNoteDetail,
    flattenNoteGroups,
    parseInitialState,
    fetchHtml,
    parseNoteInput,
    getTokenCache,
    rememberNoteTokens,
    findTokenInCollection,
    resolveNoteToken,
    resolveNoteIdentity,
    navigate,
    getNoteDetail,
    getCommentsState,
    getTopLevelComments,
    findRootComment,
    getCommentCache,
    getCommentApiContextCache,
    getCachedCommentApiContext,
    rememberCommentApiContext,
    getNoteCommentCache,
    rememberRootComments,
    findRememberedRootComment,
    rememberReplyPage,
    findKnownRootComment,
    getReplyItems,
    getReplyCursor,
    getReplyHasMore,
    openNoteAndWait,
    ensureNoteCommentApiContext,
    isSecurityRestrictionPage,
    getWebpackRequire,
    getWebpackCommentApi,
    fetchWebpackCommentPage,
    fetchWebpackReplyPage,
    getActionNames,
    findActionNames,
    findStoreActions,
    tryInvokeAction,
    tryInvokeStoreActions,
    extractCommentImageUrls,
    getCommentId,
    getCommentIds,
    extractCommentListPayload,
    extractReplyListPayload,
    normalizeCommentRecord,
  };
})();

const helper = globalThis.__bbBrowserXhsHelper;
