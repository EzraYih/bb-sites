/* @meta
{
  "name": "xiaohongshu/notes-chunk",
  "description": "分块抓取笔记详情 (notes chunk: notes, failures, stats)",
  "domain": "www.xiaohongshu.com",
  "args": {
    "items_json": {"required": true, "description": "JSON array of note candidates: [{note_id, xsec_token, title?, note_url?}]"},
    "max_items": {"required": false, "description": "Single chunk max note details to fetch"},
    "idle_min_ms": {"required": false, "description": "Minimum delay between notes inside the chunk"},
    "idle_max_ms": {"required": false, "description": "Maximum delay between notes inside the chunk"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site xiaohongshu/notes-chunk --items_json '[{\"note_id\":\"69aa7160000000001b01634d\",\"xsec_token\":\"token\"}]' --max_items 2"
}
*/

async function(args) {
  if (!args.items_json) {
    return {
      error: "Missing argument: items_json",
      hint: "Pass a JSON array of note candidates",
      action: "",
    };
  }

  // @include ./_shared.js

  const session = await helper.ensureXiaohongshuSession({ actionUrl: "https://www.xiaohongshu.com/explore" });
  if (!session.ok) return session.result;

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

  function normalizeItem(item) {
    if (typeof item === "string") {
      const noteId = item.trim();
      return noteId ? { note_id: noteId, xsec_token: null, title: null, note_url: null } : null;
    }
    if (!item || typeof item !== "object") {
      return null;
    }
    const noteId = typeof item.note_id === "string" ? item.note_id.trim() : "";
    const noteUrl = typeof item.note_url === "string" ? item.note_url.trim() : "";
    if (!noteId && !noteUrl) {
      return null;
    }
    return {
      note_id: noteId || noteUrl,
      xsec_token: typeof item.xsec_token === "string" ? item.xsec_token.trim() || null : null,
      title: typeof item.title === "string" ? item.title : null,
      note_url: noteUrl || null,
    };
  }

  function parseItemsJson(value) {
    let parsed;
    try {
      parsed = JSON.parse(String(value));
    } catch {
      throw new Error("Invalid items_json");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("items_json must be an array");
    }
    return parsed.map(normalizeItem).filter(Boolean);
  }

  function buildFailure(item, error, hint = "", action = "") {
    return {
      note_id: item?.note_id || null,
      xsec_token: item?.xsec_token || null,
      title: item?.title || null,
      note_url: item?.note_url || null,
      error: String(error || "Unknown error"),
      hint: hint || null,
      action: action || "",
    };
  }

  function mapChunkNote(mapped) {
    return {
      note_id: mapped.note_id,
      xsec_token: mapped.xsec_token,
      title: mapped.title,
      content_text: mapped.content_text,
      note_type: mapped.note_type,
      tags: mapped.tags,
      note_url: mapped.note_url,
      cover_url: mapped.cover_url,
      avatar_url: mapped.avatar_url,
      author_name: mapped.author_name,
      author_user_id: mapped.author_user_id,
      author_profile_url: mapped.author_profile_url,
      liked_count: mapped.liked_count,
      comment_count: mapped.comment_count,
      collect_count: mapped.collect_count,
      share_count: mapped.share_count,
      published_at: mapped.published_at,
      last_update_time: mapped.last_update_time,
      ip_location: mapped.ip_location,
      image_urls: mapped.image_urls,
      video_urls: mapped.video_urls,
    };
  }

  let items;
  try {
    items = parseItemsJson(args.items_json);
  } catch (error) {
    return helper.errorResult(
      error?.message || "Invalid items_json",
      "请传 JSON 数组，例如 [{\"note_id\":\"...\",\"xsec_token\":\"...\"}]",
      "",
    );
  }

  const maxItems = parsePositiveInt(args.max_items, Math.max(items.length, 1));
  const idleMinMs = parseNonNegativeInt(args.idle_min_ms, 0);
  const idleMaxMs = parseNonNegativeInt(args.idle_max_ms, idleMinMs);
  const queue = items.slice(0, maxItems);
  const notes = [];
  const failures = [];
  const startedAt = Date.now();
  let attemptedCount = 0;
  let stopReason = "completed";
  let rateLimited = false;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    attemptedCount += 1;

    const resolved = helper.resolveNoteIdentity(
      helper.firstNonEmpty(item.note_url, item.note_id),
      item.xsec_token || null,
    );

    if (!resolved.noteId) {
      failures.push(buildFailure(item, "Invalid note_id", "请传笔记 ID 或完整笔记链接", ""));
      continue;
    }
    if (!resolved.xsecToken) {
      failures.push(buildFailure(
        { ...item, note_id: resolved.noteId, note_url: resolved.url || item.note_url },
        "Missing xsec token for note",
        "请传完整笔记链接、显式传 xsec_token，或先在当前浏览器会话里搜索/打开过这篇笔记",
        "bb-browser site xiaohongshu/search <keyword>",
      ));
      continue;
    }

    const fallback = {
      note_id: resolved.noteId,
      xsec_token: resolved.xsecToken,
      title: item.title,
      note_url: item.note_url || resolved.url,
    };

    try {
      const detail = await helper.openNoteAndWait(resolved.noteId, resolved.xsecToken, false);
      const mapped = helper.mapNoteDetail(detail, fallback);
      if (!mapped.note_id) {
        failures.push(buildFailure(fallback, "Note detail unavailable", "笔记详情 store 没有暴露可用的笔记对象", ""));
        continue;
      }
      helper.rememberNoteTokens([{ id: mapped.note_id, xsecToken: mapped.xsec_token, noteCard: { noteId: mapped.note_id } }]);
      notes.push(mapChunkNote(mapped));
    } catch (error) {
      const errorText = String(error?.message || error || "Note fetch failed");
      const currentItem = { ...fallback, note_url: resolved.url || fallback.note_url };
      const securityTriggered = helper.isSecurityRestrictionPage()
        || /HTTP 429|rate.?limit|security.?restriction|visit.?too.?frequently|300013|安全限制|访问过于频繁|请稍后再试/i.test(errorText);
      failures.push(buildFailure(
        currentItem,
        errorText,
        securityTriggered
          ? "当前页面触发小红书安全限制，请稍后重试并用 --resume 恢复"
          : "笔记可能已删除、无权访问，或当前会话未能稳定加载详情",
        securityTriggered ? "bb-browser open https://www.xiaohongshu.com" : "",
      ));
      if (securityTriggered) {
        rateLimited = true;
        stopReason = "security_restriction";
        break;
      }
    }

    if (index < queue.length - 1 && idleMaxMs > 0) {
      const delayMs = randomBetween(idleMinMs, idleMaxMs);
      if (delayMs > 0) {
        await helper.sleep(delayMs);
      }
    }
  }

  return {
    count: notes.length,
    notes,
    failures,
    stats: {
      requested_count: queue.length,
      attempted_count: attemptedCount,
      completed_count: notes.length,
      failed_count: failures.length,
      elapsed_ms: Date.now() - startedAt,
      rate_limited: rateLimited,
      stop_reason: stopReason,
    },
  };
}
