# 可观测性

本文描述请求观测数据的存储职责，以及日志列表和详情 API 的展示视图。展示字段不等同于单张数据库表字段；没有直接存储的字段由服务层根据关联表推导。

## 请求观测数据分层

| 层 | 数据表 | 职责 |
| --- | --- | --- |
| 请求汇总 | `request_logs` | 请求身份、客户端协议、可选 upstream 协议摘要、逻辑模型标识、状态和创建时间 |
| 请求指标 | `request_metrics` | 请求级通用数值指标，如总耗时、TTFT、缓存命中 |
| 请求用量 | `request_usages` | 请求级或 Provider 尝试级 Token/用量明细 |
| 请求尝试 | `request_attempts` | 每次候选模型尝试、故障转移顺序、upstream 协议和结果 |
| 正文内容 | `request_contents` | 按需保存客户端请求/响应和每次 upstream 尝试正文 |
| 协议转换 | `request_conversions` | 转换前后的客户端/upstream 协议、Header、正文和流式信息 |

`request_metrics` 与 `request_usages` 不重复保存同一数值：Token、缓存 Token 和其他协议用量进入 `request_usages`；总耗时、TTFT 等请求级通用指标进入 `request_metrics`。

## 请求日志展示视图

### 请求列表

| 展示字段 | 数据来源 | 说明 |
| --- | --- | --- |
| id | `request_logs.id` | 请求唯一 ID |
| createdTime | `request_logs.createdTime` | Unix 毫秒时间戳 |
| clientProtocol | `request_logs.clientProtocol` | 客户端协议 |
| upstreamProtocol | `request_logs.upstreamProtocol` | 可选请求级 upstream 协议摘要 |
| logicalModelId | `request_logs.logicalModelId` | 逻辑模型 ID |
| status | `request_logs.status` | `pending`、`success`、`failed` 或 `cancelled` |
| durationMilliseconds | `request_metrics` | 读取 `timing.durationMilliseconds`；未记录时为空 |
| attemptCount | `request_attempts` | 按 `requestId` 汇总尝试数量 |
| contentCaptured | `request_contents.captureStatus` | 由正文记录状态派生 |

### 请求详情

请求详情由 `request_logs` 及其关联数据组合而成：

| 展示区域 | 数据来源 | 说明 |
| --- | --- | --- |
| 请求摘要 | `request_logs` | 请求身份、客户端协议、逻辑模型和最终状态 |
| 总耗时与 TTFT | `request_metrics` | 请求级通用指标，不写入 `request_logs` |
| Token 与其他用量 | `request_usages` | 必须明确请求级或 Provider 尝试级统计口径 |
| Provider 尝试 | `request_attempts` | 按 `attemptIndex` 排序展示 |
| 请求/响应正文 | `request_contents` | `attemptId = NULL` 为客户端视角；非空为对应 Provider 尝试 |
| 转换详情 | `request_conversions` | 转换前后请求、响应或流事件；转换记录不再嵌入 `request_contents` |

## Provider 尝试视图

`request_attempts` 是关系表，不是 `request_logs` 中的嵌套字段。详情 API 可将其组装为以下展示对象：

| 展示字段 | 数据来源 | 说明 |
| --- | --- | --- |
| id | `request_attempts.id` | 尝试唯一 ID |
| attemptIndex | `request_attempts.attemptIndex` | 请求内尝试顺序，从 0 开始 |
| providerId | `request_attempts.providerId` | Provider 快照标识 |
| providerModelId | `request_attempts.providerModelId` | ProviderModel 快照标识 |
| providerName | `request_attempts.providerName` | 写入时的 Provider 名称快照 |
| providerModelName | `request_attempts.providerModelName` | 写入时的 ProviderModel 名称快照 |
| upstreamProtocol | `request_attempts.upstreamProtocol` | 本次 attempt 实际使用的 upstream 协议 |
| upstreamRequestId | `request_attempts.upstreamRequestId` | 当前 upstream 返回的请求标识 |
| httpStatus | `request_attempts.httpStatus` | 当前 upstream HTTP 状态码；网络错误时为空 |
| status | `request_attempts.status` | 本次尝试结果 |
| retryable | `request_attempts.retryable` | 是否允许切换到下一个候选 |
| durationMilliseconds | `request_attempts.durationMilliseconds` | 本次尝试耗时 |
| errorCode | `request_attempts.errorCode` | 结构化错误码 |
| errorMessage | `request_attempts.errorMessage` | 错误摘要 |
| switched | 服务层派生 | `attemptIndex > 0` 或后续存在尝试时，表示发生过队列切换 |
| url | `request_attempts.url` | 写入时的实际 URL 快照，不能从当前配置反推 |

### 日志策略

- 默认保留最近 N 条请求（如 1000 条），可配置
- 支持设置保留天数，自动清理指定天数之前的请求日志；也支持在设置页立即执行清理
- 默认不保存完整请求体和响应体；用户显式开启“记录请求内容”后才采集
- 开启后记录客户端原始请求、最终响应，以及每次 upstream 尝试的请求/响应。
- 发生协议转换时，在独立的 `request_conversions` 中记录客户端与 upstream 两侧的请求 Header、响应 Header、请求正文、响应正文和流式状态。upstream 可以是供应商，也可以是协议转换器所在的中间目标。
- 正文与请求日志索引分开存储；必须配置单请求和总数据库容量保护，超限时标记 `captureStatus` 为降级/失败并停止继续采集，不影响代理请求。
- 日志清理依次删除 `request_contents`、`request_usages`、`request_metrics`、`request_attempts`，最后删除 `request_logs`。
- Authorization、API Key、Cookie 等敏感请求头始终脱敏
- 日志存储在本地应用数据目录
- 支持日志导出（JSON 格式），正文默认不包含在导出文件中

### 请求内容查看

- 请求日志列表中的每条记录提供“查看详情”入口
- 使用 Drawer 或 Dialog 展示完整请求/响应内容，不离开当前日志列表
- 详情按“客户端请求”“最终客户端响应”“Provider 尝试”分组展示
- 有协议转换时，转换内容以“转换前 / 转换后”双栏或折叠面板展示，并标注客户端协议与 Provider 协议
- JSON 正文提供格式化、折叠和复制能力；文本、SSE 事件使用等宽文本查看器
- 未开启内容记录时，在详情中明确显示状态和原因

## 用量统计

### 基础统计

- 总请求数
- 成功数 / 失败数
- 失败切换次数
- 各 Provider 调用次数：按 `request_attempts.providerId` 统计。
- 各协议调用次数：客户端协议按 `request_logs.clientProtocol` 统计，upstream 协议按 `request_attempts.upstreamProtocol` 统计。
- 平均响应时间：聚合 `request_metrics` 中的 `timing.durationMilliseconds`。
- Token 和其他用量：只聚合 `request_usages`，并明确使用请求级或 Provider 尝试级数据，避免重复计入。

### 额度处理（P1）

- 支持"手动额度阈值"：用户可为供应商设置周期请求数上限
- 支持手动标记额度耗尽
- 达到阈值后供应商自动降级，并在菜单栏/控制台提示
- 自动读取供应商真实余额不作为 MVP（各供应商接口差异大）

## 健康状态与冷却

### 健康状态

每个 Provider 和每个 ProviderModel 都维护独立的运行时健康状态。路由时必须同时检查两层冷却。

Provider 维护：

- 连续失败次数
- 冷却截止时间
- 最近成功时间
- 最近失败时间

### 冷却规则

- 连续失败达到阈值后进入短期冷却
- 默认冷却时间：30 秒 ~ 5 分钟，可按错误类型区分
- Provider 冷却期间跳过该 Provider 下的所有 ProviderModel；ProviderModel 冷却期间只跳过对应模型
- 冷却结束后允许下一次真实请求探测恢复
- 成功请求后连续失败计数重置

### 恢复策略

- MVP 不做主动健康探测
- 使用真实流量驱动状态恢复（冷却结束后的第一次请求作为探测）
- P2 可加入主动健康探测
