/* @meta
{
  "name": "xiaohongshu/search-page",
  "description": "Search one Xiaohongshu result page for workflow export",
  "domain": "www.xiaohongshu.com",
  "args": {
    "keyword": {"required": true, "description": "Search keyword"},
    "sort": {"required": false, "description": "Sort: general (default), latest, likes, comments, collects"},
    "page": {"required": false, "description": "1-based page number"},
    "limit": {"required": false, "description": "Max notes returned from this page"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/search-page fashion --sort likes --page 2 --limit 20"
}
*/

async function(args) {
  if (!args.keyword) return { error: "Missing argument: keyword", hint: "Pass a search keyword", action: "" };

  const sortAliases = {
    general: "general",
    default: "general",
    comprehensive: "general",
    latest: "time_descending",
    newest: "time_descending",
    time: "time_descending",
    time_descending: "time_descending",
    likes: "popularity_descending",
    popular: "popularity_descending",
    popularity: "popularity_descending",
    popularity_descending: "popularity_descending",
    most_likes: "popularity_descending",
    comments: "comment_descending",
    comment_descending: "comment_descending",
    most_comments: "comment_descending",
    collects: "collect_descending",
    favorites: "collect_descending",
    favourite: "collect_descending",
    collect_descending: "collect_descending",
    most_collects: "collect_descending",
  };
  const sortLabelFallbacks = {
    general: "Comprehensive",
    time_descending: "Newest",
    popularity_descending: "Most Likes",
    comment_descending: "Most Comments",
    collect_descending: "Most Collects",
  };
  const filterOrder = [
    "sort_type",
    "filter_note_type",
    "filter_note_time",
    "filter_note_range",
    "filter_pos_distance",
  ];
  const requestedPage = Math.max(1, Number.parseInt(String(args.page ?? "1"), 10) || 1);
  const requestedLimit = Math.max(1, Number.parseInt(String(args.limit ?? "20"), 10) || 20);
  const requestedSortInput = String(args.sort ?? "general").trim();
  const requestedSortKey = requestedSortInput.toLowerCase();
  const requestedSort = sortAliases[requestedSortKey] || sortAliases[requestedSortInput] || null;

  if (!requestedSort) {
    return {
      error: `Invalid sort: ${requestedSortInput}`,
      hint: "Supported sort: general, latest, likes, comments, collects",
      action: "",
    };
  }

  function buildSearchFilters(filterGroups, sortId) {
    const groups = Array.isArray(filterGroups) ? filterGroups : [];
    return filterOrder.map((groupId) => {
      const group = groups.find((item) => item?.id === groupId);
      const tags = Array.isArray(group?.filterTags) ? group.filterTags : [];
      let tagId = groupId === "sort_type" ? sortId : "不限";
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

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  const pinia = session.pinia;
  const searchStore = helper.getStore("search");
  const router = session.router || helper.getRouter();
  if (!searchStore) return helper.errorResult("Search store not found", "请确认小红书页面已经加载完成", "");
  if (!router) return helper.errorResult("Router not found", "请刷新页面后重试", "bb-browser refresh");
  if (!pinia?._s) {
    return helper.errorResult("Page not ready", "请确认小红书页面已经加载完成", helper.buildOpenAction("https://www.xiaohongshu.com/explore"));
  }

  async function waitForSearchRoute() {
    const query = { keyword: args.keyword, source: "web_search_result_notes" };
    const target = { path: "/search_result", query };
    const waitUntilReady = async (timeoutMs) => await helper.waitFor(() => {
      const route = router.currentRoute?.value;
      if (route?.path === "/search_result") return route;
      if ((location.pathname || "") === "/search_result") return route || { path: "/search_result", query };
      return null;
    }, timeoutMs, 250);

    router.push(target).catch(() => {});
    let routeReady = await waitUntilReady(6000);
    if (!routeReady) {
      try {
        await helper.navigate("/search_result", query, 1200);
      } catch {}
      routeReady = await waitUntilReady(6000);
    }

    if (!routeReady) throw new Error("Search page did not load");
    await helper.sleep(1200);
  }

  function primeSearchContext(filterGroups) {
    const filters = buildSearchFilters(filterGroups, requestedSort);
    const activeFilters = buildActiveFilters(filterGroups, filters);
    searchStore.mutateSearchValue?.(args.keyword);
    if (searchStore.searchContext) {
      searchStore.searchContext.keyword = args.keyword;
      searchStore.searchContext.page = 1;
      searchStore.searchContext.pageSize = searchStore.searchContext.pageSize || requestedLimit || 20;
      searchStore.searchContext.searchId = searchStore.searchContext.searchId
        || searchStore.rootSearchId
        || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      searchStore.searchContext.sort = requestedSort;
      searchStore.searchContext.noteType = searchStore.searchContext.noteType ?? 0;
      searchStore.searchContext.extFlags = Array.isArray(searchStore.searchContext.extFlags)
        ? searchStore.searchContext.extFlags
        : [];
      searchStore.searchContext.filters = filters;
      searchStore.searchContext.geo = searchStore.searchContext.geo || "";
      searchStore.searchContext.imageFormats = Array.isArray(searchStore.searchContext.imageFormats)
        && searchStore.searchContext.imageFormats.length
        ? searchStore.searchContext.imageFormats
        : ["jpg", "webp", "avif"];
    }
    searchStore.filterParams = filters;
    searchStore.activeFilters = activeFilters;
  }

  async function requestSearchPage(triggerLoadMore) {
    return await helper.captureJsonResponse(
      "search/notes",
      async () => {
        if (!triggerLoadMore) {
          searchStore.resetSearchNoteStore?.();
        }
        try {
          if (triggerLoadMore && searchStore.loadMore) {
            searchStore.loadMore();
          } else if (searchStore.searchNotes) {
            searchStore.searchNotes();
          } else if (searchStore.loadMore) {
            searchStore.loadMore();
          }
        } catch {}
      },
      { timeoutMs: 12000, settleMs: 300 },
    );
  }

  let availableFilters = [];
  let captured = null;
  let currentPage = 1;

  try {
    await waitForSearchRoute();
    availableFilters = await helper.waitFor(() => {
      const filters = helper.toPlain(searchStore.filters || []);
      return Array.isArray(filters) && filters.length > 0 ? filters : null;
    }, 5000, 200) || helper.toPlain(searchStore.filters || []);
    primeSearchContext(availableFilters);
    captured = await requestSearchPage(false);

    while (currentPage < requestedPage) {
      const hasMore = captured?.data?.has_more ?? searchStore?.hasMore;
      if (hasMore === false) break;
      currentPage += 1;
      captured = await requestSearchPage(true);
    }
  } catch (error) {
    const sessionState = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/search_result" });
    if (!sessionState.ok) return sessionState.result;
    return helper.errorResult(
      error?.message || "Search failed",
      "请在已打开并完成加载的小红书页面上重试",
      helper.buildOpenAction("https://www.xiaohongshu.com/search_result"),
    );
  }

  if (captured && captured.success === false) {
    if (helper.isSecurityRestrictionError(captured)) {
      return helper.buildSecurityRestrictionResult("https://www.xiaohongshu.com/search_result");
    }
    return helper.errorResult(
      captured.msg || "Search failed",
      "搜索请求已发出，但返回结果不可用",
      "",
    );
  }

  const pageSize = Number(searchStore?.searchContext?.pageSize || requestedLimit || 20);
  const aggregatedItems = Array.isArray(searchStore?.feeds) ? helper.toPlain(searchStore.feeds) : [];
  const responseItems = Array.isArray(captured?.data?.items) ? captured.data.items : null;
  const slicedItems = responseItems || aggregatedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  helper.rememberNoteTokens(aggregatedItems.length ? aggregatedItems : slicedItems);
  const notes = (Array.isArray(slicedItems) ? slicedItems : [])
    .map(helper.mapNoteCardItem)
    .filter((note) => note && /^[a-f0-9]+$/i.test(String(note.note_id)))
    .slice(0, requestedLimit)
    .map((note) => ({
      note_id: note.note_id,
      xsec_token: note.xsec_token,
      title: note.title,
      note_url: note.note_url,
      note_type: note.note_type,
      cover_url: note.cover_url,
      author_name: note.author_name,
      author_user_id: note.author_user_id,
      author_profile_url: note.author_profile_url,
      avatar_url: note.avatar_url,
      liked_count: note.liked_count,
      comment_count: note.comment_count,
      collect_count: note.collect_count,
      share_count: note.share_count,
      published_at: note.published_at,
    }));

  return {
    keyword: args.keyword,
    sort: requestedSort,
    sort_label: resolveSortLabel(availableFilters, requestedSort),
    page: currentPage,
    count: notes.length,
    has_more: captured?.data?.has_more ?? searchStore?.hasMore ?? false,
    notes,
  };
}
