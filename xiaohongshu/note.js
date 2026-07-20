/* @meta
{
  "name": "xiaohongshu/note",
  "description": "Get Xiaohongshu note details",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note ID or full note URL"},
    "ssr_fallback": {"required": false, "description": "Whether to use SSR HTML fallback when runtime store does not load"},
    "ssr_timeout_ms": {"required": false, "description": "SSR fallback timeout in milliseconds"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/note 69aa7160000000001b01634d"
}
*/

async function(args) {
  if (!args.note_id) return { error: "Missing argument: note_id" };

  const existingHelper = globalThis.__bbBrowserXhsHelper;
  const helper = existingHelper?.__noteDiagnosticsVersion === 2
    || (existingHelper?.rememberNoteTokens && typeof document === "undefined")
    ? existingHelper
    : (globalThis.__bbBrowserXhsHelper = (() => {
    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
    function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
    function getGlobals() { return getApp()?.config?.globalProperties || null; }
    function getPinia() { return getGlobals()?.$pinia || null; }
    function getRouter() { return getGlobals()?.$router || null; }
    function getStore(name) { return getPinia()?._s?.get(name) || null; }
    function toPlain(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value ?? null; } }
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
        sleep(timeoutMs).then(() => { throw new Error(message); })
      ]);
    }
    function normalizeUser(user) {
      if (!user || typeof user !== "object") return null;
      const nickname = user.nickname ?? user.name ?? user.nickName ?? null;
      const userId = user.userId ?? user.user_id ?? user.userid ?? user.id ?? null;
      const redId = user.redId ?? user.red_id ?? user.redid ?? null;
      const desc = user.desc ?? user.description ?? null;
      const gender = user.gender ?? null;
      if (!nickname && !userId && !redId) return null;
      return {
        nickname,
        red_id: redId,
        desc,
        gender,
        userid: userId,
        url: userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : null
      };
    }
    function mapNoteCardItem(item) {
      const card = item?.noteCard || item?.note_card || item;
      if (!card || typeof card !== "object") return null;
      const noteId = item?.id ?? card.noteId ?? card.note_id ?? null;
      const xsecToken = item?.xsecToken ?? item?.xsec_token ?? card.xsecToken ?? card.xsec_token ?? null;
      const user = card.user || {};
      if (!noteId || !/^[a-f0-9]+$/i.test(String(noteId))) return null;
      return {
        id: noteId,
        note_id: noteId,
        xsec_token: xsecToken,
        title: card.displayTitle ?? card.display_title ?? card.title ?? null,
        type: card.type ?? null,
        url: xsecToken
          ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=`
          : `https://www.xiaohongshu.com/explore/${noteId}`,
        author: user.nickname ?? user.nickName ?? null,
        author_id: user.userId ?? user.user_id ?? null,
        likes: card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? null,
        cover: card.cover?.urlDefault ?? card.cover?.urlPre ?? card.cover?.url ?? card.imageList?.[0]?.urlDefault ?? null,
        time: card.lastUpdateTime ?? card.last_update_time ?? card.time ?? null
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
      return (0, eval)("(" + match[1] + ")");
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
        try { xsecToken = decodeURIComponent(tokenMatch[1]); } catch { xsecToken = tokenMatch[1]; }
      }
      return { noteId, xsecToken };
    }
    function buildNoteUrl(noteId, xsecToken, xsecSource) {
      const source = xsecSource || "pc_search";
      return `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(source)}`;
    }
    function getNoteStoreSnapshot(noteId) {
      const noteStore = getStore("note");
      const detailMap = noteStore?.noteDetailMap || {};
      return {
        state: noteStore?.state ?? null,
        currentNoteId: noteStore?.currentNoteId ?? noteStore?.currentNote?.noteId ?? null,
        hasTargetDetail: Boolean(noteId && detailMap?.[noteId]?.note?.noteId === noteId),
        detailMapSize: detailMap && typeof detailMap === "object" ? Object.keys(detailMap).length : 0
      };
    }
    function detectManualVerification() {
      if (typeof document === "undefined") return null;
      const url = String(location?.href || "");
      if (/verify|captcha|risk|security|challenge/i.test(url)) {
        return { reason: "url", text: url.slice(0, 500), url };
      }
      const selectors = [
        "[role='dialog']",
        ".modal",
        ".captcha",
        ".verify",
        ".verification",
        ".security",
        "[class*='captcha' i]",
        "[class*='verify' i]",
        "[class*='security' i]"
      ];
      const textPattern = /安全验证|请完成验证|身份验证|验证码|拖动滑块|滑块验证|选择.*验证|继续访问|verify|verification|captcha|challenge/i;
      const candidates = [];
      for (const selector of selectors) {
        try {
          candidates.push(...document.querySelectorAll(selector));
        } catch {}
      }
      candidates.push(document.body);
      for (const element of candidates) {
        const text = String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
        if (text && textPattern.test(text)) {
          return { reason: "dom", text: text.slice(0, 500), url };
        }
      }
      return null;
    }
    function assertNoManualVerification() {
      const detected = detectManualVerification();
      if (!detected) return;
      throw new Error(`XHS_MANUAL_VERIFICATION_REQUIRED: detail collection is blocked by a manual verification dialog; reason=${detected.reason}; text=${detected.text}`);
    }
    function getTokenCache() {
      if (!globalThis.__bbBrowserXhsTokenCache) globalThis.__bbBrowserXhsTokenCache = {};
      return globalThis.__bbBrowserXhsTokenCache;
    }
    function rememberNoteTokens(items) {
      const cache = getTokenCache();
      if (!Array.isArray(items)) return cache;
      for (const item of items) {
        const mapped = mapNoteCardItem(item);
        if (mapped?.id && mapped.xsec_token) cache[mapped.id] = mapped.xsec_token;
      }
      return cache;
    }
    function findTokenInCollection(items, noteId) {
      if (!Array.isArray(items)) return null;
      for (const item of items) {
        const mapped = mapNoteCardItem(item);
        if (mapped?.id === noteId && mapped.xsec_token) return mapped.xsec_token;
      }
      return null;
    }
    function resolveNoteToken(noteId) {
      if (!noteId) return null;
      const cached = getTokenCache()[noteId];
      if (cached) return cached;
      const detail = getStore("note")?.noteDetailMap?.[noteId];
      const direct = detail?.note?.xsecToken ?? detail?.note?.xsec_token ?? null;
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
    function resolveNoteIdentity(input) {
      const parsed = parseNoteInput(input);
      const xsecToken = parsed.xsecToken || resolveNoteToken(parsed.noteId);
      return {
        noteId: parsed.noteId,
        xsecToken,
        url: parsed.noteId && xsecToken ? buildNoteUrl(parsed.noteId, xsecToken) : null
      };
    }
    async function navigate(path, query, waitMs = 1500) {
      const router = getRouter();
      if (!router) throw new Error("Router not found");
      router.push({ path, query }).catch(() => {});
      const targetPath = String(path ?? "");
      await waitFor(() => {
        const route = router.currentRoute?.value;
        if (!route) return null;
        const currentPath = typeof route.path === "string" ? route.path : "";
        const currentFullPath = typeof route.fullPath === "string" ? route.fullPath : "";
        return currentPath === targetPath
          || currentPath.startsWith(`${targetPath}?`)
          || currentFullPath === targetPath
          || currentFullPath.startsWith(`${targetPath}?`)
          ? route
          : null;
      }, Math.min(waitMs, 150), 50);
      return router.currentRoute?.value || null;
    }
    async function openNoteAndWait(noteId, xsecToken, requireComments = false, diagnostics = null, xsecSource = "pc_search") {
      if (!noteId || !xsecToken) throw new Error("Missing note id or xsec token");
      assertNoManualVerification();
      const noteStore = getStore("note");
      if (!noteStore) throw new Error("Note store not found");
      const cachedDetail = noteStore.noteDetailMap?.[noteId];
      if (cachedDetail?.note?.noteId === noteId) {
        if (diagnostics) diagnostics.source = "cache";
        if (!requireComments) return toPlain(cachedDetail);
        const cachedComments = cachedDetail.comments?.list;
        if (Array.isArray(cachedComments) && (cachedComments.length > 0 || cachedDetail.comments?.firstRequestFinish)) {
          return toPlain(cachedDetail);
        }
      }
      const routeStartedAt = Date.now();
      await navigate(`/explore/${noteId}`, {
        xsec_token: xsecToken,
        xsec_source: xsecSource || "pc_search",
        source: "web_explore_feed",
      }, 1800);
      assertNoManualVerification();
      if (diagnostics) diagnostics.routeWaitMs += Date.now() - routeStartedAt;
      if (noteStore.setCurrentNoteId) noteStore.setCurrentNoteId(noteId);
      if (noteStore.getNoteDetailByNoteId) {
        try {
          Promise.resolve(noteStore.getNoteDetailByNoteId(noteId)).catch(() => {});
        } catch {}
      }
      const storeStartedAt = Date.now();
      const detail = await waitFor(() => {
        assertNoManualVerification();
        const current = noteStore.noteDetailMap?.[noteId];
        if (!current?.note || current.note.noteId !== noteId) return null;
        if (!requireComments) return toPlain(current);
        const list = current.comments?.list;
        if (Array.isArray(list) && (list.length > 0 || current.comments?.firstRequestFinish)) return toPlain(current);
        return null;
      }, requireComments ? 12000 : 8000, 250);
      if (diagnostics) diagnostics.storeWaitMs += Date.now() - storeStartedAt;
      if (!detail) throw new Error(requireComments ? "Note comments not loaded" : "Note detail not loaded");
      if (diagnostics) diagnostics.source = "store";
      return detail;
    }
    return {
      __noteDiagnosticsVersion: 2,
      sleep,
      getPinia,
      getRouter,
      getStore,
      toPlain,
      waitFor,
      withTimeout,
      normalizeUser,
      mapNoteCardItem,
      flattenNoteGroups,
      parseInitialState,
      fetchHtml,
      parseNoteInput,
      buildNoteUrl,
      getNoteStoreSnapshot,
      detectManualVerification,
      assertNoManualVerification,
      rememberNoteTokens,
      resolveNoteIdentity,
      openNoteAndWait
    };
  })());

  const startedAt = Date.now();
  const ssrFallback = String(args.ssr_fallback ?? "true").trim().toLowerCase() !== "false";
  const ssrTimeoutMs = Math.max(1, Number(args.ssr_timeout_ms ?? 5000) || 5000);
  const diagnostics = {
    source: null,
    routeWaitMs: 0,
    storeWaitMs: 0,
    ssrFetchMs: 0,
    totalElapsedMs: 0,
    storeStateBefore: null,
    storeStateAfter: null
  };
  function snapshotStore(noteId) {
    if (helper.getNoteStoreSnapshot) return helper.getNoteStoreSnapshot(noteId);
    const noteStore = helper.getStore?.("note");
    const detailMap = noteStore?.noteDetailMap || {};
    return {
      state: noteStore?.state ?? null,
      currentNoteId: noteStore?.currentNoteId ?? null,
      hasTargetDetail: Boolean(noteId && detailMap?.[noteId]?.note?.noteId === noteId),
      detailMapSize: detailMap && typeof detailMap === "object" ? Object.keys(detailMap).length : 0
    };
  }
  function finish(payload) {
    diagnostics.routeDegraded = diagnostics.routeWaitMs >= 3000;
    diagnostics.totalElapsedMs = Date.now() - startedAt;
    return { ...payload, _diagnostics: diagnostics };
  }
  function withLocalTimeout(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
    ]);
  }

  const pinia = helper.getPinia();
  const userStore = helper.getStore("user");
  helper.assertNoManualVerification?.();
  if (!userStore?.loggedIn) return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore — then log in manually" };
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
      hint: "Pass a full note URL, or search/feed that note first so its token is available in the current page data"
    };
  }

  let detail;
  try {
    diagnostics.storeStateBefore = snapshotStore(resolved.noteId);
    helper.assertNoManualVerification?.();
    const cachedDetail = helper.getStore("note")?.noteDetailMap?.[resolved.noteId];
    if (cachedDetail?.note?.noteId === resolved.noteId) {
      diagnostics.source = "cache";
      detail = helper.toPlain ? helper.toPlain(cachedDetail) : cachedDetail;
    } else {
      detail = await helper.openNoteAndWait(resolved.noteId, resolved.xsecToken, false, diagnostics);
    }
    diagnostics.storeStateAfter = snapshotStore(resolved.noteId);
  } catch (error) {
    diagnostics.storeStateAfter = snapshotStore(resolved.noteId);
    if (!ssrFallback) {
      diagnostics.source = "store_timeout";
      return finish({
        error: error?.message || "Note fetch failed",
        hint: "Runtime note detail did not load before SSR fallback was disabled"
      });
    }
    try {
      const ssrStartedAt = Date.now();
      const html = resolved.url
        ? await withLocalTimeout(Promise.resolve(helper.fetchHtml(resolved.url)), ssrTimeoutMs, "SSR fallback timed out")
        : null;
      diagnostics.ssrFetchMs = Date.now() - ssrStartedAt;
      const state = html ? helper.parseInitialState(html) : null;
      const ssrNote = state?.note?.noteDetailMap?.[resolved.noteId]?.note;

      if (ssrNote) {
        diagnostics.source = "ssr";
        detail = { note: ssrNote };
      } else {
        throw error;
      }
    } catch (ssrError) {
      diagnostics.ssrFetchMs = diagnostics.ssrFetchMs || ssrTimeoutMs;
      diagnostics.source = ssrError?.message === "SSR fallback timed out" ? "ssr_timeout" : "ssr_error";
      return finish({
        error: error?.message || "Note fetch failed",
        hint: "The note may be unavailable, deleted, or restricted"
      });
    }
  }

  const note = detail?.note;
  if (!note) return { error: "Note detail unavailable" };

  const token = note.xsecToken ?? resolved.xsecToken;
  helper.rememberNoteTokens([{ id: resolved.noteId, xsecToken: token, noteCard: { noteId: resolved.noteId } }]);
  return finish({
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
    ip_location: note.ipLocation ?? null
  });
}
