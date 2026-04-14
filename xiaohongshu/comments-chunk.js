/* @meta
{
  "name": "xiaohongshu/comments-chunk",
  "description": "分块抓取评论 (comments chunk: comments, session, stats)",
  "domain": "www.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "笔记 ID 或完整笔记链接"},
    "xsec_token": {"required": false, "description": "可选 xsec token"},
    "session_id": {"required": false, "description": "分块会话 ID，默认按 note_id 生成"},
    "state_json": {"required": false, "description": "可选会话状态 JSON，用于恢复或重建会话"},
    "reset": {"required": false, "description": "是否重置当前分块会话，传 1/true 表示重置"},
    "top_limit": {"required": false, "description": "单次一级评论请求的 limit"},
    "reply_limit": {"required": false, "description": "单次楼中楼回复请求的 limit"},
    "max_requests": {"required": false, "description": "本 chunk 最多发起多少次评论 API 请求"},
    "max_top_pages": {"required": false, "description": "本 chunk 最多抓取多少页一级评论"},
    "max_reply_pages": {"required": false, "description": "本 chunk 最多抓取多少页楼中楼回复"},
    "context_warmup_ms": {"required": false, "description": "进入笔记上下文后的额外预热等待"},
    "idle_min_ms": {"required": false, "description": "chunk 内请求间最小随机间隔"},
    "idle_max_ms": {"required": false, "description": "chunk 内请求间最大随机间隔"},
    "heavy_reply_threshold": {"required": false, "description": "重回复线程阈值，超过后延后入队"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/comments-chunk 69aa7160000000001b01634d --max_requests 12 --max_top_pages 2 --max_reply_pages 10"
}
*/

async function(args) {
  if (!args.note_id) {
    return { error: "Missing argument: note_id", hint: "Pass a note ID or full note URL", action: "" };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

  const resolved = helper.resolveNoteIdentity(args.note_id, args.xsec_token || null);
  if (!resolved.noteId) {
    return helper.errorResult("Invalid note_id", "请传笔记 ID 或完整笔记链接", "");
  }
  if (!resolved.xsecToken) {
    return helper.errorResult(
      "Missing xsec token for note",
      "请传完整笔记链接、显式传 xsec_token，或先在当前浏览器会话里搜索/打开过这篇笔记",
      "bb-browser site xiaohongshu/search <keyword>",
    );
  }

  function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  function parseNonNegativeInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  function randomBetween(min, max) {
    const lower = Math.max(0, Math.floor(Math.min(min, max)));
    const upper = Math.max(lower, Math.floor(Math.max(min, max)));
    return lower + Math.floor(Math.random() * (upper - lower + 1));
  }

  function getChunkSessionStore() {
    if (!globalThis.__bbBrowserXhsCommentChunkSessions) {
      globalThis.__bbBrowserXhsCommentChunkSessions = {};
    }
    return globalThis.__bbBrowserXhsCommentChunkSessions;
  }

  function normalizeQueueItem(item) {
    const commentId = helper.firstNonEmpty(item?.comment_id, item?.commentId);
    if (!commentId) return null;
    return {
      comment_id: String(commentId),
      sub_comment_count: Math.max(0, Number(item?.sub_comment_count) || 0),
      reply_cursor: helper.firstNonEmpty(item?.reply_cursor, item?.replyCursor) || null,
      reply_page_index: Math.max(1, Number(item?.reply_page_index) || Number(item?.replyPageIndex) || 1),
    };
  }

  function dedupeQueue(items) {
    const queue = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = normalizeQueueItem(item);
      if (!normalized || seen.has(normalized.comment_id)) continue;
      seen.add(normalized.comment_id);
      queue.push(normalized);
    }
    return queue;
  }

  function createEmptySessionState(sessionId) {
    return {
      session_id: sessionId,
      note_id: resolved.noteId,
      xsec_token: resolved.xsecToken,
      note_url: resolved.url,
      top_cursor: null,
      top_page_index: 1,
      top_done: false,
      reply_queue: [],
      request_page_count: 0,
      top_page_count: 0,
      reply_page_count: 0,
      chunk_count: 0,
      updated_at: new Date().toISOString(),
    };
  }

  function normalizeSessionState(raw, sessionId) {
    const base = createEmptySessionState(sessionId);
    if (!raw || typeof raw !== "object") {
      return base;
    }
    return {
      session_id: helper.firstNonEmpty(raw.session_id, raw.sessionId, sessionId) || sessionId,
      note_id: helper.firstNonEmpty(raw.note_id, raw.noteId, base.note_id) || base.note_id,
      xsec_token: helper.firstNonEmpty(raw.xsec_token, raw.xsecToken, base.xsec_token) || base.xsec_token,
      note_url: helper.firstNonEmpty(raw.note_url, raw.noteUrl, base.note_url) || base.note_url,
      top_cursor: helper.firstNonEmpty(raw.top_cursor, raw.topCursor) || null,
      top_page_index: Math.max(1, Number(raw.top_page_index) || Number(raw.topPageIndex) || 1),
      top_done: Boolean(raw.top_done ?? raw.topDone),
      reply_queue: dedupeQueue(raw.reply_queue || raw.replyQueue),
      request_page_count: Math.max(0, Number(raw.request_page_count) || Number(raw.requestPageCount) || 0),
      top_page_count: Math.max(0, Number(raw.top_page_count) || Number(raw.topPageCount) || 0),
      reply_page_count: Math.max(0, Number(raw.reply_page_count) || Number(raw.replyPageCount) || 0),
      chunk_count: Math.max(0, Number(raw.chunk_count) || Number(raw.chunkCount) || 0),
      updated_at: helper.firstNonEmpty(raw.updated_at, raw.updatedAt) || base.updated_at,
    };
  }

  function parseStateJson(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("Invalid state_json");
    }
  }

  function getSessionKey(sessionId) {
    return `${resolved.noteId}:${sessionId}`;
  }

  function normalizeTopLevelComments(items, topLimit) {
    return (Array.isArray(items) ? items : []).slice(0, topLimit).map((comment) => {
      const commentId = helper.getCommentId(comment);
      const contentText = helper.firstNonEmpty(comment?.content, comment?.text, comment?.desc);
      return helper.normalizeCommentRecord(comment, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: null,
      });
    });
  }

  function buildReplyTaskGroups(items, topLimit, heavyReplyThreshold) {
    const normal = [];
    const heavy = [];

    for (const comment of (Array.isArray(items) ? items : []).slice(0, topLimit)) {
      const commentId = helper.getCommentId(comment);
      if (!commentId) continue;

      const contentText = helper.firstNonEmpty(comment?.content, comment?.text, comment?.desc);
      const rootRecord = helper.normalizeCommentRecord(comment, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: null,
      });
      const previewReplies = helper.getReplyItems(comment).map((reply) => helper.normalizeCommentRecord(reply, {
        note_id: resolved.noteId,
        note_url: resolved.url,
        root_comment_id: commentId,
        root_comment_content: contentText,
        parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, commentId),
      }));
      const subCommentCount = Math.max(0, Number(rootRecord.sub_comment_count || 0));
      const replyCursor = helper.getReplyCursor(comment) || null;
      const replyHasMore = helper.getReplyHasMore(comment);
      const previewCount = previewReplies.length;
      const needsReplyFetch = subCommentCount > 0 && (replyHasMore || subCommentCount > previewCount);

      const task = needsReplyFetch
        ? {
            comment_id: String(commentId),
            sub_comment_count: subCommentCount,
            reply_cursor: replyHasMore ? replyCursor : null,
            reply_page_index: 1,
          }
        : null;

      const target = task && subCommentCount >= heavyReplyThreshold ? heavy : normal;
      target.push({
        task,
        preview_replies: previewReplies,
      });
    }

    return { normal, heavy };
  }

  function upsertReplyTask(queue, incomingTask) {
    const nextTask = normalizeQueueItem(incomingTask);
    if (!nextTask) return;

    const existingIndex = queue.findIndex((item) => item.comment_id === nextTask.comment_id);
    if (existingIndex >= 0) {
      const current = queue[existingIndex];
      queue[existingIndex] = {
        comment_id: current.comment_id,
        sub_comment_count: Math.max(current.sub_comment_count, nextTask.sub_comment_count),
        reply_cursor: current.reply_cursor ?? nextTask.reply_cursor,
        reply_page_index: Math.max(current.reply_page_index, nextTask.reply_page_index),
      };
      return;
    }

    queue.push(nextTask);
  }

  function addCommentDelta(delta, seen, comment) {
    const commentId = helper.firstNonEmpty(comment?.comment_id, comment?.commentId);
    if (!commentId) return;
    const key = String(commentId);
    if (seen.has(key)) return;
    seen.add(key);
    delta.push(comment);
  }

  function normalizeReplyComments(rootComment, replies, replyLimit) {
    const rootContent = helper.firstNonEmpty(rootComment?.content, rootComment?.text, rootComment?.desc);
    return (Array.isArray(replies) ? replies : []).slice(0, replyLimit).map((reply) => helper.normalizeCommentRecord(reply, {
      note_id: resolved.noteId,
      note_url: resolved.url,
      root_comment_id: rootComment?.id || rootComment?.comment_id || rootComment?.commentId || null,
      root_comment_content: rootContent,
      parent_comment_id: helper.firstNonEmpty(reply?.parentCommentId, reply?.parent_comment_id, rootComment?.id),
    }));
  }

  async function maybeIdle(requestIndex, idleMinMs, idleMaxMs) {
    if (requestIndex <= 0 || idleMaxMs <= 0) return;
    const delayMs = randomBetween(idleMinMs, idleMaxMs);
    if (delayMs > 0) {
      await helper.sleep(delayMs);
    }
  }

  const topLimit = parsePositiveInt(args.top_limit ?? args.limit, 20);
  const replyLimit = parsePositiveInt(args.reply_limit, 10);
  const maxRequests = parsePositiveInt(args.max_requests, 12);
  const maxTopPages = parseNonNegativeInt(args.max_top_pages, 2);
  const maxReplyPages = parseNonNegativeInt(args.max_reply_pages, Math.max(0, maxRequests - maxTopPages));
  const contextWarmupMs = parseNonNegativeInt(args.context_warmup_ms, 0);
  const idleMinMs = parseNonNegativeInt(args.idle_min_ms, 0);
  const idleMaxMs = parseNonNegativeInt(args.idle_max_ms, idleMinMs);
  const heavyReplyThreshold = parsePositiveInt(args.heavy_reply_threshold, 100);
  const reset = helper.toBoolean(args.reset);
  const sessionId = helper.firstNonEmpty(args.session_id, `comments:${resolved.noteId}`) || `comments:${resolved.noteId}`;
  const sessionStore = getChunkSessionStore();
  const sessionKey = getSessionKey(sessionId);

  let incomingState = null;
  try {
    incomingState = parseStateJson(args.state_json);
  } catch (error) {
    return helper.errorResult(
      error?.message || "Invalid state_json",
      "state_json 必须是合法 JSON",
      "",
    );
  }

  if (reset) {
    delete sessionStore[sessionKey];
  }

  const cachedState = sessionStore[sessionKey];
  let state;
  let sessionOrigin;

  if (incomingState) {
    state = normalizeSessionState(incomingState, sessionId);
    sessionOrigin = "args";
  } else if (cachedState) {
    state = normalizeSessionState(cachedState, sessionId);
    sessionOrigin = "cache";
  } else {
    state = createEmptySessionState(sessionId);
    sessionOrigin = "fresh";
  }

  if (String(state.note_id) !== String(resolved.noteId) || String(state.xsec_token || "") !== String(resolved.xsecToken || "")) {
    state = createEmptySessionState(sessionId);
    sessionOrigin = "fresh";
  }

  const startedAt = Date.now();
  const commentsDelta = [];
  const seenDeltaIds = new Set();
  let requestCount = 0;
  let topPagesFetched = 0;
  let replyPagesFetched = 0;

  try {
    await helper.ensureNoteCommentApiContext(resolved.noteId, resolved.xsecToken, {
      warmupMs: sessionOrigin === "fresh" || sessionOrigin === "args" ? contextWarmupMs : 0,
    });

    while (
      requestCount < maxRequests
      && topPagesFetched < maxTopPages
      && !state.top_done
    ) {
      await maybeIdle(requestCount, idleMinMs, idleMaxMs);

      const cursorIn = state.top_cursor || "";
      const page = await helper.fetchWebpackCommentPage(
        resolved.noteId,
        resolved.xsecToken,
        cursorIn,
        topLimit,
      );

      for (const comment of normalizeTopLevelComments(page.items, topLimit)) {
        addCommentDelta(commentsDelta, seenDeltaIds, comment);
      }

      const taskGroups = buildReplyTaskGroups(page.items, topLimit, heavyReplyThreshold);
      for (const group of [taskGroups.normal, taskGroups.heavy]) {
        for (const item of group) {
          for (const previewReply of item.preview_replies) {
            addCommentDelta(commentsDelta, seenDeltaIds, previewReply);
          }
          if (item.task) {
            upsertReplyTask(state.reply_queue, item.task);
          }
        }
      }

      const nextCursor = page.has_more && page.cursor_out && page.cursor_out !== cursorIn
        ? String(page.cursor_out)
        : null;
      state.top_cursor = nextCursor;
      state.top_done = !nextCursor;
      state.top_page_index = Math.max(1, Number(state.top_page_index) || 1) + 1;
      requestCount += 1;
      topPagesFetched += 1;
    }

    while (
      requestCount < maxRequests
      && replyPagesFetched < maxReplyPages
      && state.reply_queue.length > 0
    ) {
      const root = state.reply_queue.shift();
      if (!root) break;

      await maybeIdle(requestCount, idleMinMs, idleMaxMs);

      const cursorIn = root.reply_cursor || "";
      const page = await helper.fetchWebpackReplyPage(
        resolved.noteId,
        root.comment_id,
        resolved.xsecToken,
        cursorIn,
        replyLimit,
      );
      const rootComment = helper.findKnownRootComment(resolved.noteId, root.comment_id) || { id: root.comment_id };

      for (const reply of normalizeReplyComments(rootComment, page.items, replyLimit)) {
        addCommentDelta(commentsDelta, seenDeltaIds, reply);
      }

      const nextReplyCursor = page.has_more && page.cursor_out && page.cursor_out !== cursorIn
        ? String(page.cursor_out)
        : null;
      if (nextReplyCursor) {
        state.reply_queue.push({
          comment_id: root.comment_id,
          sub_comment_count: root.sub_comment_count,
          reply_cursor: nextReplyCursor,
          reply_page_index: Math.max(1, Number(root.reply_page_index) || 1) + 1,
        });
      }

      requestCount += 1;
      replyPagesFetched += 1;
    }
  } catch (error) {
    if (helper.isSecurityRestrictionPage() || helper.isSecurityRestrictionError(error)) {
      return helper.buildSecurityRestrictionResult(resolved.url || "https://www.xiaohongshu.com/explore");
    }

    const sessionState = await helper.ensureXiaohongshuSession({ actionUrl: resolved.url || "https://www.xiaohongshu.com/explore" });
    if (!sessionState.ok) return sessionState.result;

    return helper.errorResult(
      error?.message || "Comments chunk failed",
      "评论 chunk 采集失败，请确认当前页面未进入安全限制页，且笔记仍可访问",
      "",
    );
  }

  state.request_page_count = Math.max(0, Number(state.request_page_count) || 0) + requestCount;
  state.top_page_count = Math.max(0, Number(state.top_page_count) || 0) + topPagesFetched;
  state.reply_page_count = Math.max(0, Number(state.reply_page_count) || 0) + replyPagesFetched;
  state.chunk_count = Math.max(0, Number(state.chunk_count) || 0) + 1;
  state.note_url = resolved.url;
  state.updated_at = new Date().toISOString();
  const done = state.top_done && state.reply_queue.length === 0;

  sessionStore[sessionKey] = state;

  return {
    note_id: resolved.noteId,
    note_url: resolved.url,
    session_id: sessionId,
    session_origin: sessionOrigin,
    done,
    count: commentsDelta.length,
    comments: commentsDelta,
    session: state,
    stats: {
      request_count: requestCount,
      top_pages_fetched: topPagesFetched,
      reply_pages_fetched: replyPagesFetched,
      reply_queue_size: state.reply_queue.length,
      elapsed_ms: Date.now() - startedAt,
    },
  };
}
