# xiaohongshu/search Adapter 流程说明

## 概述
xiaohongshu/search adapter 用于在小红书（Xiaohongshu）平台上搜索笔记内容。该 adapter 通过拦截网络请求和操作页面状态来实现搜索功能，支持多种排序方式、分页加载和状态恢复。

## 主要参数
- `keyword`: 必需，搜索关键词
- `sort`: 可选，排序方式（general, latest, likes, comments, collects）
- `resume_mode`: 可选，恢复模式（start, warm, cold, auto）
- `search_session_id`: 可选，前次搜索会话ID
- `expected_frontier_note_ids`: 可选，冷恢复期望边界笔记ID
- `max_rounds`: 可选，最大加载轮次数
- `time_budget_ms`: 可选，时间预算（毫秒）

## 流程步骤

### 1. 参数验证和初始化
- 验证必需参数 `keyword`，无则返回错误
- 设置默认配置：maxRounds=1, timeBudgetMs=0, jitter 延迟等
- 处理排序参数，支持多种别名映射（general, latest, likes 等）
- 生成或使用搜索会话ID用于状态追踪

### 2. 辅助工具初始化
创建 helper 对象，包含页面交互工具：
- `sleep`: 异步延迟
- `getPinia/getStore`: 获取页面状态管理器
- `waitFor`: 等待条件满足
- `mapNoteCardItem`: 标准化笔记数据结构
- `rememberNoteTokens`: 缓存笔记访问令牌

### 3. 登录和页面状态检查
- 检查用户登录状态，未登录返回错误
- 验证页面 Pinia store 是否可用
- 确认搜索 store 存在

### 4. 网络请求拦截设置
- 拦截 XMLHttpRequest.prototype.open/send
- 拦截 globalThis.fetch
- 捕获包含 "search/notes" 的请求响应，提取搜索结果数据

### 5. 搜索执行流程

#### 5.1 导航到搜索页面
- 根据 resume_mode 判断是否可热恢复：
  - `warm` 模式：检查会话ID匹配且已在搜索页面
  - 其他模式：导航到 `/search_result` 页面
- 等待页面加载完成

#### 5.2 获取和设置搜索过滤器
- 从 searchStore 获取可用过滤器
- 构建应用过滤器参数（sort_type, filter_note_type 等）
- 设置搜索上下文（keyword, page, pageSize, sort 等）

#### 5.3 执行搜索轮次
- 第一轮：执行初始搜索或 loadMore
- 后续轮次：检查 has_more 和时间预算，循环加载更多结果
- 每个轮次应用随机 jitter 延迟（避免检测）
- 等待搜索结果捕获和 store 状态稳定

### 6. 结果处理和返回
- 从 store.feeds 或捕获响应提取原始笔记数据
- 使用 mapNoteCardItem 标准化笔记格式
- 记录统计信息：请求次数、延迟时间、轮次持续时间
- 返回结构化结果包含：
  - 搜索参数（keyword, sort, session_id）
  - 结果统计（count, has_more, stop_reason）
  - 性能指标（request_count, jitter_sleeps 等）
  - 笔记列表和边界信息（frontier_note_ids）

## 关键机制

### Resume Modes
- `start/cold`：重新搜索
- `warm`：继续加载
- `auto`：自动选择

### Jitter
随机延迟模拟人类行为，避免被检测

### Token Caching
缓存笔记访问令牌用于后续请求

### Error Handling
处理超时、页面未就绪、搜索失败等异常

### State Persistence
通过 session_id 保持搜索状态跨调用