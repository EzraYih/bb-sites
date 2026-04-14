# bb-sites

[bb-browser](https://github.com/epiral/bb-browser) 的社区网站适配器 — 把网站变成 CLI 命令。

每个适配器是一个 JS 函数，通过 `bb-browser eval` 在你的浏览器里运行。浏览器已经登录了 — 不需要 API key，不需要偷 Cookie，不需要反爬。

[English](README.md) · [中文](README.zh-CN.md)

> **102 个适配器**，覆盖 **36 个平台** — 持续增长中。

## 快速开始

```bash
bb-browser site update                     # 安装/更新适配器
bb-browser site list                       # 列出所有命令
bb-browser site reddit/me                  # 运行命令
bb-browser site reddit/thread <url>        # 带参数运行
```

## 适配器列表

### 🔍 搜索引擎

| 平台 | 命令 | 说明 |
|------|------|------|
| Google | `google/search` | Google 搜索 |
| 百度 | `baidu/search` | 百度搜索 |
| Bing | `bing/search` | Bing 搜索 |
| DuckDuckGo | `duckduckgo/search` | DuckDuckGo 搜索（HTML 轻量版） |
| 搜狗 | `sogou/weixin` | 搜狗微信文章搜索 |

### 📰 新闻资讯

| 平台 | 命令 | 说明 |
|------|------|------|
| BBC | `bbc/news` | BBC 新闻头条（RSS）或搜索 |
| 路透社 | `reuters/search` | 路透社新闻搜索 |
| 今日头条 | `toutiao/search`, `toutiao/hot` | 头条搜索、热榜 |
| 东方财富 | `eastmoney/news` | 财经热点新闻 |

### 💬 社交媒体

| 平台 | 命令 | 说明 |
|------|------|------|
| Twitter/X | `twitter/user`, `twitter/thread`, `twitter/search`, `twitter/tweets`, `twitter/notifications` | 用户资料、推文线程、搜索、时间线、通知 |
| Reddit | `reddit/me`, `reddit/posts`, `reddit/thread`, `reddit/context` | 用户信息、发帖、讨论树、评论链 |
| 微博 | `weibo/me`, `weibo/hot`, `weibo/feed`, `weibo/user`, `weibo/user_posts`, `weibo/post`, `weibo/comments` | 完整微博支持 — 资料、热搜、时间线、发帖、评论 |
| 微博 (手机版) | `m_weibo/me`, `m_weibo/hot`, `m_weibo/feed`, `m_weibo/search`, `m_weibo/user`, `m_weibo/user_posts`, `m_weibo/comments` | 移动端优化版 — 基于稳定的 JSON 接口 |
| 虎扑 | `hupu/hot` | 虎扑步行街热帖 |

### 💻 技术开发

| 平台 | 命令 | 说明 |
|------|------|------|
| GitHub | `github/me`, `github/repo`, `github/issues`, `github/issue-create`, `github/pr-create`, `github/fork` | 用户信息、仓库、Issue、PR、Fork |
| Hacker News | `hackernews/top`, `hackernews/thread` | 热门文章、帖子 + 评论树 |
| Stack Overflow | `stackoverflow/search` | 搜索问答 |
| CSDN | `csdn/search` | CSDN 技术文章搜索 |
| 博客园 | `cnblogs/search` | 博客园技术文章搜索 |
| npm | `npm/search` | 搜索 npm 包 |
| PyPI | `pypi/search`, `pypi/package` | 搜索 & 查看 Python 包详情 |
| arXiv | `arxiv/search` | 搜索学术论文 |
| Dev.to | `devto/search` | 搜索 Dev.to 文章 |
| V2EX | `v2ex/hot`, `v2ex/latest`, `v2ex/topic` | 最热/最新主题、主题详情 + 回复 |

### 🎬 影音娱乐

| 平台 | 命令 | 说明 |
|------|------|------|
| YouTube | `youtube/search`, `youtube/video`, `youtube/comments`, `youtube/channel`, `youtube/feed`, `youtube/transcript` | 搜索、视频详情、评论、频道、Feed、字幕文稿 |
| B站 | `bilibili/me`, `bilibili/popular`, `bilibili/ranking`, `bilibili/search`, `bilibili/video`, `bilibili/comments`, `bilibili/feed`, `bilibili/history`, `bilibili/trending` | 完整 B站 支持 — 9 个适配器 |
| IMDb | `imdb/search` | IMDb 电影搜索 |
| Genius | `genius/search` | 歌曲/歌词搜索 |
| 豆瓣 | `douban/search`, `douban/movie`, `douban/movie-hot`, `douban/movie-top`, `douban/top250`, `douban/comments` | 豆瓣电影 — 搜索、详情、排行、Top 250、短评 |
| 起点中文网 | `qidian/search` | 小说搜索 |

### 💼 求职招聘

| 平台 | 命令 | 说明 |
|------|------|------|
| BOSS直聘 | `boss/search`, `boss/detail` | 搜索职位、查看 JD 详情 |
| LinkedIn | `linkedin/profile`, `linkedin/search` | 用户 Profile、帖子搜索 |

### 💰 财经股票

| 平台 | 命令 | 说明 |
|------|------|------|
| 东方财富 | `eastmoney/stock`, `eastmoney/news` | 股票实时行情、财经新闻 |
| Yahoo Finance | `yahoo-finance/quote` | 美股行情（AAPL, TSLA 等） |

### 📱 数码科技

| 平台 | 命令 | 说明 |
|------|------|------|
| GSMArena | `gsmarena/search` | 手机参数搜索 |
| Product Hunt | `producthunt/today` | 今日热门产品 |

### 📚 知识百科

| 平台 | 命令 | 说明 |
|------|------|------|
| 维基百科 | `wikipedia/search`, `wikipedia/summary` | 搜索、页面摘要 |
| 知乎 | `zhihu/me`, `zhihu/hot`, `zhihu/question`, `zhihu/search` | 用户信息、热榜、问答、搜索 |
| Open Library | `openlibrary/search` | 图书搜索 |

### 🌐 生活服务

| 平台 | 命令 | 说明 |
|------|------|------|
| 有道翻译 | `youdao/translate` | 翻译/词典查询 |
| 携程 | `ctrip/search` | 目的地景点搜索 |

### 🗨️ 即时通讯

| 平台 | 命令 | 说明 |
|------|------|------|
| 即刻 | `jike/feed`, `jike/search` | 推荐 Feed、搜索动态 |
| 小红书 | `xiaohongshu/me`, `xiaohongshu/feed`, `xiaohongshu/search`, `xiaohongshu/note`, `xiaohongshu/comments`, `xiaohongshu/user_posts`, `xiaohongshu/search-page`, `xiaohongshu/note-detail`, `xiaohongshu/notes-chunk`, `xiaohongshu/comments-page`, `xiaohongshu/comment-replies-page`, `xiaohongshu/comments-chunk` | 完整小红书支持，含批量导出工作流原子能力、分块笔记详情抓取与分块评论抓取 |

> 所有小红书适配器使用 **Pinia Store Actions** — 调用页面自己的 Vue store 函数，走完整的签名 + 拦截器链路。零逆向。

#### 小红书适配器详细说明

| 命令 | 说明 | 参数 |
|------|------|------|
| `xiaohongshu/me` | 获取当前登录用户信息 | 无 |
| `xiaohongshu/feed` | 获取首页推荐 Feed 流 | 无 |
| `xiaohongshu/search` | 搜索笔记，返回所有结果 | `keyword` (必填), `sort` (可选: general/latest/likes/comments/collects) |
| `xiaohongshu/note` | 获取单篇笔记详情 | `note_id` (必填: 笔记ID或完整笔记URL) |
| `xiaohongshu/comments` | 获取笔记的全部评论 | `note_id` (必填) |
| `xiaohongshu/user_posts` | 获取指定用户的笔记列表 | `user_id` (必填) |
| `xiaohongshu/search-page` | 搜索单页结果（支持分页导出，用于工作流批量抓取） | `keyword` (必填), `sort` (可选: general/默认综合, latest/最新, likes/最多点赞, comments/最多评论, collects/最多收藏), `page` (可选, 默认1, 从1开始的页码), `limit` (可选, 默认20, 每页返回的笔记数) |
| `xiaohongshu/note-detail` | 获取笔记详情（工作流导出格式，含更多字段） | `note_id` (必填), `xsec_token` (可选) |
| `xiaohongshu/notes-chunk` | 在一次调用中分块抓取少量笔记详情（用于工作流批量导出） | `items_json` (必填), `max_items` (可选), `idle_min_ms` / `idle_max_ms` (可选) |
| `xiaohongshu/comments-page` | 获取一级评论分页（支持游标分页，用于工作流批量抓取） | `note_id` (必填), `xsec_token` (可选), `cursor` (可选, 用于翻页的游标), `limit` (可选, 默认50, 每页返回的评论数) |
| `xiaohongshu/comment-replies-page` | 获取楼中楼回复分页（用于工作流批量抓取） | `note_id` (必填), `comment_id` (必填, 一级评论ID), `xsec_token` (可选), `cursor` (可选), `limit` (可选, 默认100) |
| `xiaohongshu/comments-chunk` | 在一次调用中分块推进多页一级评论与楼中楼回复（用于工作流批量导出） | `note_id` (必填), `xsec_token` (可选), `session_id` (可选), `state_json` (可选), `max_requests` (可选), `max_top_pages` (可选), `max_reply_pages` (可选), `context_warmup_ms` (可选), `idle_min_ms` / `idle_max_ms` (可选) |

> 批量导出场景推荐组合使用 `xiaohongshu/search-page`、`xiaohongshu/notes-chunk` 与 `xiaohongshu/comments-chunk`：先按搜索摘要筛选笔记，再用 `notes-chunk` 分块抓详情，用 `comments-chunk` 分块抓评论。

#### 小红书工作流说明

- 当前仓库的 `feature/xhs-export` 分支，是和 `bb-browser` `0.11.3` `feature/xhs-export` 分支、`bb-xhs-export` 当前 `main` 分支配套使用的适配器集合。
- 这套导出栈应直接检出到 `~/.bb-browser/bb-sites`。如果你正在使用小红书导出链路，请直接在这个仓库里 `git pull`，不要再用社区版 `bb-browser site update` 覆盖本地 fork 适配器。
- `xiaohongshu/search-page`、`xiaohongshu/note-detail`、`xiaohongshu/notes-chunk`、`xiaohongshu/comments-page`、`xiaohongshu/comment-replies-page`、`xiaohongshu/comments-chunk` 都是面向批量导出的工作流原语，字段名和分页契约尽量保持机器友好，方便 `bb-xhs-export` 这类下游工具直接消费。
- `xiaohongshu/notes-chunk` 是当前推荐的笔记详情批量抓取入口：一次调用里顺序打开少量入选笔记，返回详情结果与逐条失败信息，本身不维护会话状态，方便 exporter 保持轻量 checkpoint。
- `xiaohongshu/comments-chunk` 是当前推荐的评论高吞吐入口：一次调用里推进多页一级评论和楼中楼回复，并返回可恢复的 session state。

#### 小红书校验流程

```bash
bb-browser site xiaohongshu/me
bb-browser site xiaohongshu/feed
bb-browser site xiaohongshu/search "穿搭"
bb-browser site xiaohongshu/note 6932814d000000001e034e67
bb-browser site xiaohongshu/comments 6932814d000000001e034e67
bb-browser site xiaohongshu/user_posts 67c99deb00000000070013e9
bb-browser site xiaohongshu/search-page "穿搭" --sort likes --page 2
bb-browser site xiaohongshu/note-detail 6932814d000000001e034e67
bb-browser site xiaohongshu/notes-chunk --items_json '[{"note_id":"6932814d000000001e034e67","xsec_token":"<token>"}]' --max_items 2
bb-browser site xiaohongshu/comments-page 6932814d000000001e034e67
bb-browser site xiaohongshu/comment-replies-page 6932814d000000001e034e67 1234567890
bb-browser site xiaohongshu/comments-chunk 6932814d000000001e034e67 --max_requests 12 --max_top_pages 2 --max_reply_pages 10
```

## 使用示例

```bash
# 搜索
bb-browser site google/search "bb-browser"
bb-browser site duckduckgo/search "Claude Code"

# 社交媒体
bb-browser site twitter/search "claude code"
bb-browser site twitter/tweets plantegg
bb-browser site reddit/thread https://reddit.com/r/programming/comments/...
bb-browser site weibo/hot

# 技术调研
bb-browser site github/repo epiral/bb-browser
bb-browser site hackernews/top 10
bb-browser site stackoverflow/search "python async await"
bb-browser site arxiv/search "large language model"
bb-browser site npm/search "react state management"

# 影音娱乐
bb-browser site youtube/transcript dQw4w9WgXcQ
bb-browser site bilibili/search 编程
bb-browser site douban/top250

# 财经股票
bb-browser site yahoo-finance/quote AAPL
bb-browser site eastmoney/stock 贵州茅台

# 求职
bb-browser site boss/search "AI agent"
bb-browser site linkedin/search "AI agent"

# 翻译
bb-browser site youdao/translate hello
```

## 开发适配器

运行 `bb-browser guide` 查看完整开发流程，或阅读 [SKILL.md](SKILL.md)。

```javascript
/* @meta
{
  "name": "platform/command",
  "description": "这个适配器做什么",
  "domain": "www.example.com",
  "args": {
    "query": {"required": true, "description": "搜索关键词"}
  },
  "readOnly": true,
  "example": "bb-browser site platform/command value1"
}
*/

async function(args) {
  if (!args.query) return {error: 'Missing argument: query'};
  const resp = await fetch('/api/search?q=' + encodeURIComponent(args.query), {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  return await resp.json();
}
```

## 贡献

```bash
# 方式 A：使用 gh CLI
gh repo fork epiral/bb-sites --clone
cd bb-sites && git checkout -b feat-mysite
# 添加适配器文件
git push -u origin feat-mysite
gh pr create

# 方式 B：使用 bb-browser（不需要 gh）
bb-browser site github/fork epiral/bb-sites
git clone https://github.com/你的用户名/bb-sites && cd bb-sites
git checkout -b feat-mysite
# 添加适配器文件
git push -u origin feat-mysite
bb-browser site github/pr-create epiral/bb-sites --title "feat(mysite): 添加适配器" --head "你的用户名:feat-mysite"
```

## 私有适配器

私有适配器放在 `~/.bb-browser/sites/`，同名时优先于社区适配器。

```
~/.bb-browser/
├── sites/          # 私有适配器（优先）
│   └── internal/
│       └── deploy.js
└── bb-sites/       # 本仓库（bb-browser site update）
    ├── reddit/
    ├── twitter/
    ├── github/
    ├── youtube/
    ├── bilibili/
    ├── zhihu/
    ├── weibo/
    ├── douban/
    ├── xiaohongshu/
    ├── google/
    ├── ...          # 35 个平台目录
    └── qidian/
```
