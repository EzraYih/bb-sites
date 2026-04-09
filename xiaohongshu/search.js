/* @meta
{
  "name": "xiaohongshu/search",
  "description": "Search Xiaohongshu notes",
  "domain": "www.xiaohongshu.com",
  "args": {
    "keyword": {"required": true, "description": "Search keyword"},
    "sort": {"required": false, "description": "Sort: general (default), latest, likes, comments, collects"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/search fashion --sort likes"
}
*/

async function(args) {
  if (!args.keyword) return { error: "Missing argument: keyword" };

  const sortAliases = {
    general: "general",
    default: "general",
    comprehensive: "general",
    "综合": "general",
    latest: "time_descending",
    newest: "time_descending",
    time: "time_descending",
    time_descending: "time_descending",
    "最新": "time_descending",
    likes: "popularity_descending",
    popular: "popularity_descending",
    popularity: "popularity_descending",
    popularity_descending: "popularity_descending",
    most_likes: "popularity_descending",
    "最多点赞": "popularity_descending",
    comments: "comment_descending",
    comment_descending: "comment_descending",
    most_comments: "comment_descending",
    "最多评论": "comment_descending",
    collects: "collect_descending",
    favorites: "collect_descending",
    favourite: "collect_descending",
    collect_descending: "collect_descending",
    most_collects: "collect_descending",
    "最多收藏": "collect_descending",
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
  const requestedSortInput = String(args.sort ?? "general").trim();
  const requestedSortKey = requestedSortInput.toLowerCase();
  const requestedSort = sortAliases[requestedSortKey] || sortAliases[requestedSortInput] || null;
  if (!requestedSort) {
    return {
      error: `Invalid sort: ${requestedSortInput}`,
      hint: "Supported sort: general, latest, likes, comments, collects",
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

  const pinia = helper.getPinia();
  const userStore = helper.getStore("user");
  if (!userStore?.loggedIn) {
    return { error: "Not logged in", hint: "Run: bb-browser open https://www.xiaohongshu.com/explore then log in manually" };
  }
  if (!pinia?._s) {
    return { error: "Page not ready", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  const searchStore = helper.getStore("search");
  if (!searchStore) {
    return { error: "Search store not found", hint: "Ensure xiaohongshu.com is fully loaded" };
  }

  const router = helper.getRouter();
  if (!router) {
    return { error: "Router not found", hint: "Refresh the page and retry" };
  }

  let availableFilters = [];
  let appliedFilterParams = buildSearchFilters([], requestedSort);

  let captured;
  try {
    captured = await helper.captureJsonResponse(
      "search/notes",
      async () => {
        router.push({
          path: "/search_result",
          query: { keyword: args.keyword, source: "web_search_result_notes" },
        }).catch(() => {});

        const routeReady = await helper.waitFor(() => {
          const route = router.currentRoute?.value;
          if (!route) return null;
          return route.path === "/search_result" ? route : null;
        }, 10000, 250);

        if (!routeReady) {
          throw new Error("Search page did not load");
        }

        await helper.sleep(1200);

        availableFilters = await helper.waitFor(() => {
          const filters = helper.toPlain(searchStore.filters || []);
          return Array.isArray(filters) && filters.length > 0 ? filters : null;
        }, 5000, 200) || helper.toPlain(searchStore.filters || []);

        appliedFilterParams = buildSearchFilters(availableFilters, requestedSort);
        const activeFilters = buildActiveFilters(availableFilters, appliedFilterParams);

        searchStore.mutateSearchValue?.(args.keyword);
        if (searchStore.searchContext) {
          searchStore.searchContext.keyword = args.keyword;
          searchStore.searchContext.page = 1;
          searchStore.searchContext.pageSize = searchStore.searchContext.pageSize || 20;
          searchStore.searchContext.searchId = searchStore.searchContext.searchId || searchStore.rootSearchId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

        searchStore.resetSearchNoteStore?.();
        try {
          if (searchStore.searchNotes) {
            searchStore.searchNotes();
          } else if (searchStore.loadMore) {
            searchStore.loadMore();
          }
        } catch {}
      },
      { timeoutMs: 12000, settleMs: 300 },
    );
  } catch (error) {
    return {
      error: error?.message || "Search failed",
      hint: "Retry from an open Xiaohongshu tab",
    };
  }

  const rawItems = Array.isArray(captured?.data?.items)
    ? captured.data.items
    : helper.toPlain(searchStore.feeds || []);

  helper.rememberNoteTokens(rawItems);

  const notes = (Array.isArray(rawItems) ? rawItems : [])
    .map(helper.mapNoteCardItem)
    .filter((note) => note && /^[a-f0-9]+$/i.test(String(note.id)));

  if (captured && captured.success === false) {
    return {
      error: captured.msg || "Search failed",
      hint: "Search request reached Xiaohongshu but did not return usable results",
    };
  }

  return {
    keyword: args.keyword,
    sort: requestedSort,
    sort_label: resolveSortLabel(availableFilters, requestedSort),
    count: notes.length,
    has_more: captured?.data?.has_more ?? searchStore?.hasMore ?? false,
    notes,
  };
}
