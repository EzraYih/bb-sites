/* @meta
{
  "name": "xiaohongshu/search",
  "description": "Search Xiaohongshu notes",
  "domain": "www.xiaohongshu.com",
  "args": {
    "keyword": {"required": true, "description": "Search keyword"},
    "sort": {"required": false, "description": "Sort: general (default), latest, likes, comments, collects"},
    "resume_mode": {"required": false, "description": "Resume mode: start, warm, cold, auto"},
    "search_session_id": {"required": false, "description": "Previous search session id"},
    "expected_frontier_note_ids": {"required": false, "description": "Expected frontier note ids for cold catch-up"},
    "time_budget_ms": {"required": false, "description": "Time budget for this call in milliseconds"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/search fashion --sort likes"
}
*/

async function(args) {
  const startedAt = Date.now();
  if (!args.keyword) return { error: "Missing argument: keyword" };
  const timeBudgetMs = Math.max(0, Number(args.time_budget_ms ?? 0) || 0);
  const jitterMinMs = Math.max(0, Number(args.load_more_jitter_min_ms ?? 0) || 0);
  const jitterMaxMs = Math.max(jitterMinMs, Number(args.load_more_jitter_max_ms ?? jitterMinMs) || jitterMinMs);

  const sortAliases = {
    general: "general",
    default: "general",
    comprehensive: "general",
    "\u7efc\u5408": "general",
    latest: "time_descending",
    newest: "time_descending",
    time: "time_descending",
    time_descending: "time_descending",
    "\u6700\u65b0": "time_descending",
    likes: "popularity_descending",
    popular: "popularity_descending",
    popularity: "popularity_descending",
    popularity_descending: "popularity_descending",
    most_likes: "popularity_descending",
    "\u6700\u591a\u70b9\u8d5e": "popularity_descending",
    comments: "comment_descending",
    comment_descending: "comment_descending",
    most_comments: "comment_descending",
    "\u6700\u591a\u8bc4\u8bba": "comment_descending",
    collects: "collect_descending",
    favorites: "collect_descending",
    favourite: "collect_descending",
    collect_descending: "collect_descending",
    most_collects: "collect_descending",
    "\u6700\u591a\u6536\u85cf": "collect_descending"
  };
  const sortLabelFallbacks = {
    general: "Comprehensive",
    time_descending: "Newest",
    popularity_descending: "Most Likes",
    comment_descending: "Most Comments",
    collect_descending: "Most Collects"
  };
  const filterOrder = [
    "sort_type",
    "filter_note_type",
    "filter_note_time",
    "filter_note_range",
    "filter_pos_distance"
  ];
  const requestedSortInput = String(args.sort ?? "general").trim();
  const requestedSortKey = requestedSortInput.toLowerCase();
  const requestedSort = sortAliases[requestedSortKey] || sortAliases[requestedSortInput] || null;
  const requestedResumeMode = String(args.resume_mode ?? "start").trim().toLowerCase();
  const resumeModeUsed = requestedResumeMode === "auto" ? "start" : requestedResumeMode;
  const searchSessionId = typeof args.search_session_id === "string" && args.search_session_id.trim()
    ? args.search_session_id.trim()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  if (!requestedSort) {
    return {
      error: `Invalid sort: ${requestedSortInput}`,
      hint: "Supported sort: general, latest, likes, comments, collects"
    };
  }

  function buildSearchFilters(filterGroups, sortId) {
    const groups = Array.isArray(filterGroups) ? filterGroups : [];
    return filterOrder.map((groupId) => {
      const group = groups.find((item) => item?.id === groupId);
      const tags = Array.isArray(group?.filterTags) ? group.filterTags : [];
      let tagId = groupId === "sort_type" ? sortId : "\u4e0d\u9650";
      if (groupId === "sort_type") {
        const matched = tags.find((tag) => tag?.id === sortId);
        if (matched?.id) tagId = matched.id;
      } else if (tags[0]?.id) {
        tagId = tags[0].id;
      }
      return { tags: [tagId], type: groupId };
    });
  }

  function buildActiveFilters(filterGroups, filterParams) {
    const groups = Array.isArray(filterGroups) ? filterGroups : [];
    return filterOrder.map((groupId) => {
      const group = groups.find((item) => item?.id === groupId);
      const tags = Array.isArray(group?.filterTags) ? group.filterTags : [];
      const selected = filterParams.find((item) => item?.type === groupId)?.tags?.[0];
      const index = tags.findIndex((tag) => tag?.id === selected);
      return index >= 0 ? index : 0;
    });
  }

  function resolveSortLabel(filterGroups, sortId) {
    const groups = Array.isArray(filterGroups) ? filterGroups : [];
    const sortGroup = groups.find((item) => item?.id === "sort_type");
    const matched = Array.isArray(sortGroup?.filterTags)
      ? sortGroup.filterTags.find((tag) => tag?.id === sortId)
      : null;
    return matched?.name || sortLabelFallbacks[sortId] || sortId;
  }

  const helper = globalThis.__bbBrowserXhsHelper?.rememberNoteTokens
    && (
      globalThis.__bbBrowserXhsHelper?.__bbSearchAdapterVersion === 2
      || typeof document === "undefined"
    )
    ? globalThis.__bbBrowserXhsHelper
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
    function extractXsecSource(item) {
      // Level 1: API 响应字段
      const direct = item?.xsec_source ?? item?.xsecSource ?? null;
      if (direct) return String(direct);
      // Level 2: DOM <a> 标签 href 解析
      if (typeof document !== "undefined") {
        const noteId = item?.id ?? item?.noteCard?.noteId ?? item?.note_card?.note_id;
        if (noteId) {
          const anchor = document.querySelector('a[href*="/explore/' + noteId + '"]');
          if (anchor) {
            try {
              const href = anchor.getAttribute("href") || anchor.href || "";
              const url = new URL(href, location.origin);
              const fromHref = url.searchParams.get("xsec_source");
              if (fromHref) return fromHref;
            } catch {}
          }
        }
      }
      // Level 3: 默认值
      return "pc_search";
    }
    function mapNoteCardItem(item) {
      const card = item?.noteCard || item?.note_card || item;
      if (!card || typeof card !== "object") return null;
      const noteId = item?.id ?? card.noteId ?? card.note_id ?? null;
      const xsecToken = item?.xsecToken ?? item?.xsec_token ?? card.xsecToken ?? card.xsec_token ?? null;
      const xsecSource = extractXsecSource(item);
      const user = card.user || {};
      if (!noteId || !/^[a-f0-9]+$/i.test(String(noteId))) return null;
      return {
        note_id: noteId,
        xsec_token: xsecToken,
        xsec_source: xsecSource,
        title: card.displayTitle ?? card.display_title ?? card.title ?? null,
        type: card.type ?? null,
        url: xsecToken
          ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}`
          : `https://www.xiaohongshu.com/explore/${noteId}`,
        author: user.nickname ?? user.nickName ?? null,
        author_id: user.userId ?? user.user_id ?? null,
        likes: card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? null,
        comments: card.interactInfo?.commentCount ?? card.interact_info?.comment_count ?? null,
        collects: card.interactInfo?.collectedCount ?? card.interact_info?.collected_count ?? null,
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
    function buildMappedNoteIndex(items) {
      const index = new Map();
      if (!Array.isArray(items)) return index;
      for (const item of items) {
        const mapped = mapNoteCardItem(item);
        if (mapped?.note_id) index.set(mapped.note_id, mapped);
      }
      return index;
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
      await sleep(waitMs);
      return router.currentRoute?.value || null;
    }
    async function openNoteAndWait(noteId, xsecToken, requireComments = false, xsecSource = "pc_search") {
      if (!noteId || !xsecToken) throw new Error("Missing note id or xsec token");
      const noteStore = getStore("note");
      if (!noteStore) throw new Error("Note store not found");
      await navigate(`/explore/${noteId}`, {
        xsec_token: xsecToken,
        xsec_source: xsecSource || "pc_search",
        source: "web_explore_feed",
      }, 1800);
      if (noteStore.setCurrentNoteId) noteStore.setCurrentNoteId(noteId);
      if (noteStore.getNoteDetailByNoteId) {
        try {
          await withTimeout(noteStore.getNoteDetailByNoteId(noteId), 6000, "Note detail load timed out");
        } catch {}
      }
      const detail = await waitFor(() => {
        const current = noteStore.noteDetailMap?.[noteId];
        if (!current?.note || current.note.noteId !== noteId) return null;
        if (!requireComments) return toPlain(current);
        const list = current.comments?.list;
        if (Array.isArray(list) && (list.length > 0 || current.comments?.firstRequestFinish)) return toPlain(current);
        return null;
      }, requireComments ? 12000 : 8000, 250);
      if (!detail) throw new Error(requireComments ? "Note comments not loaded" : "Note detail not loaded");
      return detail;
    }
    return {
      __bbSearchAdapterVersion: 2,
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
      rememberNoteTokens,
      resolveNoteIdentity,
      openNoteAndWait,
      navigate
    };
  })());

  const pinia = await helper.waitFor(() => helper.getPinia()?._s, 15000, 500);
  if (!pinia) {
    return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded (waited 15s)" };
  }

  const userStore = await helper.waitFor(() => helper.getStore("user"), 15000, 500);
  if (!userStore?.loggedIn) return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore — then log in manually" };

  const searchStore = await helper.waitFor(() => helper.getStore("search"), 15000, 500);
  if (!searchStore) {
    return { error: "Search store not found", hint: "Ensure xiaohongshu.com is fully loaded (waited 15s)" };
  }

  let availableFilters = [];
  let appliedFilterParams = buildSearchFilters([], requestedSort);

  let captured = null;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origFetch = globalThis.fetch;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__bbUrl = url;
    return origOpen.apply(this, arguments);
  };

  const searchKeyword = args.keyword;
  function pickJitterSleepMs() {
    if (jitterMaxMs <= jitterMinMs) return jitterMinMs;
    return Math.floor(Math.random() * (jitterMaxMs - jitterMinMs + 1)) + jitterMinMs;
  }

  XMLHttpRequest.prototype.send = function(body) {
    if (String(this.__bbUrl || "").includes("search/notes")) {
      const request = this;
      const orig = request.onreadystatechange;
      request.onreadystatechange = function() {
        if (request.readyState === 4 && !captured) {
          try {
            const parsed = JSON.parse(request.responseText);
            if (parsed?.data?.items) captured = parsed;
          } catch {}
        }
        if (orig) return orig.apply(this, arguments);
      };
    }
    return origSend.apply(this, arguments);
  };

  globalThis.fetch = async function(resource, init) {
    const response = await origFetch.apply(this, arguments);
    try {
      const url = typeof resource === "string" ? resource : resource?.url;
      if (!captured && url && String(url).includes("search/notes")) {
        const parsed = await response.clone().json();
        if (parsed?.data?.items) captured = parsed;
      }
    } catch {}
    return response;
  };

  try {
    const router = helper.getRouter();
    if (!router) {
      return { error: "Router not found", hint: "Refresh the page and retry" };
    }
    const canWarmResume = resumeModeUsed === "warm"
      && searchSessionId
      && searchStore.__bbSearchSessionId === searchSessionId
      && router.currentRoute?.value?.path === "/search_result"
      && typeof searchStore.loadMore === "function";

    if (!canWarmResume) {
      router.push({
        path: "/search_result",
        query: { keyword: args.keyword, source: "web_search_result_notes" }
      }).catch(() => {});

      const routeReady = await helper.waitFor(() => {
        const route = router.currentRoute?.value;
        if (!route) return null;
        return route.path === "/search_result" ? route : null;
      }, 10000, 250);

      if (!routeReady) {
        return { error: "Search page did not load", hint: "Retry from an open Xiaohongshu tab" };
      }

      await helper.sleep(1200);
    }

    availableFilters = await helper.waitFor(() => {
      const filters = helper.toPlain(searchStore.filters || []);
      return Array.isArray(filters) && filters.length > 0 ? filters : null;
    }, 5000, 200) || helper.toPlain(searchStore.filters || []);

    appliedFilterParams = buildSearchFilters(availableFilters, requestedSort);
    const activeFilters = buildActiveFilters(availableFilters, appliedFilterParams);

    if (!canWarmResume) {
      searchStore.mutateSearchValue?.(args.keyword);
      if (searchStore.searchContext) {
        searchStore.searchContext.keyword = args.keyword;
        searchStore.searchContext.page = 1;
        searchStore.searchContext.pageSize = searchStore.searchContext.pageSize || 20;
        searchStore.searchContext.searchId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        searchStore.searchContext.sort = requestedSort;
        searchStore.searchContext.noteType = searchStore.searchContext.noteType ?? 0;
        searchStore.searchContext.extFlags = Array.isArray(searchStore.searchContext.extFlags) ? searchStore.searchContext.extFlags : [];
        searchStore.searchContext.filters = appliedFilterParams;
        searchStore.searchContext.geo = searchStore.searchContext.geo || "";
        searchStore.searchContext.imageFormats = Array.isArray(searchStore.searchContext.imageFormats) && searchStore.searchContext.imageFormats.length
          ? searchStore.searchContext.imageFormats
          : ["jpg", "webp", "avif"];
      }
      searchStore.filterParams = appliedFilterParams;
      searchStore.activeFilters = activeFilters;
    }

    let requestCount = 0;
    let jitterSleeps = 0;
    let jitterSleepMs = 0;
    let diagnosticLogged = false;
    const roundDurations = [];
    const roundDiagnostics = [];

    async function waitForStoreToSettle(previousFeedsLength, previousPage) {
      await helper.waitFor(() => {
        const currentFeedsLength = Array.isArray(searchStore.feeds) ? searchStore.feeds.length : 0;
        const currentPage = searchStore.searchContext?.page ?? null;
        const currentState = searchStore.state ?? null;
        const domExploreLinkCount = typeof document !== "undefined"
          ? document.querySelectorAll('a[href*="/explore/"]').length
          : 0;

        if (currentState && currentState !== "loading") return true;
        if (currentFeedsLength > previousFeedsLength) return true;
        if (currentPage !== null && previousPage !== null && currentPage > previousPage) return true;
        if (domExploreLinkCount > 0) return true;
        return null;
      }, 3000, 150);
    }

    async function runRound(fn) {
      const roundStartedAt = Date.now();
      const previousFeedsLength = Array.isArray(searchStore.feeds) ? searchStore.feeds.length : 0;
      const previousPage = searchStore.searchContext?.page ?? null;
      captured = null;
      try {
        fn?.();
      } catch {}
      await helper.waitFor(() => captured, 12000, 200);
      if (captured && !diagnosticLogged && Array.isArray(captured?.data?.items) && captured.data.items.length > 0) {
        diagnosticLogged = true;
        const firstItem = captured.data.items[0];
        const itemKeys = Object.keys(firstItem || {});
        const cardKeys = Object.keys(firstItem?.noteCard || firstItem?.note_card || {});
        console.log(JSON.stringify({
          __bb_diag: {
            type: "search_api_fields",
            item_keys: itemKeys,
            card_keys: cardKeys,
            has_xsec_source: itemKeys.includes("xsec_source") || itemKeys.includes("xsecSource"),
          }
        }));
      }
      await waitForStoreToSettle(previousFeedsLength, previousPage);
      const afterFeedsLength = Array.isArray(searchStore.feeds) ? searchStore.feeds.length : 0;
      roundDurations.push(Date.now() - roundStartedAt);
      roundDiagnostics.push({
        captured_items: Array.isArray(captured?.data?.items) ? captured.data.items.length : 0,
        feeds_before: previousFeedsLength,
        feeds_after: afterFeedsLength,
      });
      requestCount += 1;
    }

    await runRound(() => {
      if (canWarmResume && searchStore.loadMore) {
        searchStore.loadMore();
      } else if (searchStore.searchNotes) {
        searchStore.resetSearchNoteStore?.();
        if (searchStore.feeds) searchStore.feeds = [];
        searchStore.searchNotes();
      } else if (searchStore.loadMore) {
        searchStore.loadMore();
      }
    });

    searchStore.__bbRequestCount = requestCount;
    searchStore.__bbJitterSleeps = jitterSleeps;
    searchStore.__bbJitterSleepMs = jitterSleepMs;
    searchStore.__bbRoundDurations = roundDurations;
    searchStore.__bbRoundDiagnostics = roundDiagnostics;
    searchStore.__bbSearchSessionId = searchSessionId;
  } finally {
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
    globalThis.fetch = origFetch;
  }

  const accumulatedFeeds = helper.toPlain(searchStore.feeds || []);
  const capturedItems = Array.isArray(captured?.data?.items) ? captured.data.items : [];

  // Cache xsec_tokens from ALL accumulated feeds (not just this round)
  helper.rememberNoteTokens(accumulatedFeeds);

  // Build notes from THIS ROUND's API response only (delta)
  const capturedItemIndex = (() => {
    const index = new Map();
    for (const item of capturedItems) {
      const mapped = helper.mapNoteCardItem(item);
      if (mapped?.note_id) index.set(mapped.note_id, mapped);
    }
    return index;
  })();

  const notes = capturedItems
    .map((item) => {
      const mapped = helper.mapNoteCardItem(item);
      if (!mapped?.note_id) return null;
      const enriched = capturedItemIndex.get(mapped.note_id);
      if (!enriched) return mapped;
      return {
        ...mapped,
        comments: mapped.comments ?? enriched.comments ?? null,
        collects: mapped.collects ?? enriched.collects ?? null
      };
    })
    .filter((note) => note && /^[a-f0-9]+$/i.test(String(note.note_id)));

  if (captured && captured.success === false) {
    return {
      error: captured.msg || "Search failed",
      hint: "Search request reached Xiaohongshu but did not return usable results"
    };
  }

  const requestCount = searchStore.__bbRequestCount ?? 1;
  const jitterSleeps = searchStore.__bbJitterSleeps ?? 0;
  const jitterSleepMs = searchStore.__bbJitterSleepMs ?? 0;
  const roundDurations = Array.isArray(searchStore.__bbRoundDurations) ? searchStore.__bbRoundDurations : [Date.now() - startedAt];
  const roundDiagnostics = Array.isArray(searchStore.__bbRoundDiagnostics)
    ? searchStore.__bbRoundDiagnostics.map((d) => helper.toPlain(d))
    : [];
  const hasMore = captured?.data?.has_more ?? searchStore?.hasMore ?? false;
  const stopReason = notes.length === 0
    ? "search_failed"
    : !hasMore
      ? "has_more_false"
      : timeBudgetMs > 0 && Date.now() - startedAt >= timeBudgetMs
        ? "time_budget_reached"
        : "max_rounds_reached";

  return {
    keyword: args.keyword,
    sort: requestedSort,
    sort_label: resolveSortLabel(availableFilters, requestedSort),
    resume_mode_used: resumeModeUsed,
    search_session_id: searchSessionId,
    count: notes.length,
    added_count: notes.length,
    total_unique_count: Array.isArray(accumulatedFeeds) ? accumulatedFeeds.length : notes.length,
    has_more: hasMore,
    stop_reason: stopReason,
    request_count: requestCount,
    jitter_sleeps: jitterSleeps,
    jitter_sleep_ms: jitterSleepMs,
    round_durations_ms: roundDurations,
    round_diagnostics: roundDiagnostics,
    frontier_note_ids: (Array.isArray(accumulatedFeeds) ? accumulatedFeeds : [])
      .slice(-5)
      .map((item) => {
        const mapped = helper.mapNoteCardItem(item);
        return mapped?.note_id;
      })
      .filter(Boolean),
    frontier_matched: null,
    notes
  };
}
