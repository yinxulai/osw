# 版本规划与验收标准

本文分为"设计定稿""实施计划"和"功能待办"三部分。新版本按定稿 specs 从头实施，不以兼容旧代码为目标。

## 一、设计定稿（已完成）

以下设计文档已评审定稿，是后续实施的唯一依据；当前仅完成设计，尚未开始按此目标迁移实现代码。

- [x] [data-model.md](./data-model.md)：16 张核心表基线，含 provider_settings、provider_endpoints、provider_model_endpoints、provider_model_health、scheduling_policies、protocol_converters、request_metrics、request_usages；采用标准字段结构化列、多值关系表、受限 JSON 正文/协议详情、请求观测分层、软删除和 Unix 毫秒时间戳。
- [x] [proxy.md](./proxy.md)：协议适配器（ProtocolAdapter）+ 共享骨架（handler 编排 / transport 纯 I/O / hooks 观测订阅）的代理管线架构。
- [x] [product.md](./product.md)、[protocol-conversion.md](./protocol-conversion.md)、[server-architecture.md](./server-architecture.md)、[tech-architecture.md](./tech-architecture.md)、[security-privacy.md](./security-privacy.md)、[observability.md](./observability.md)。

### 产品与设计原则（摘要）

- 身份、关系、枚举、开关、数值以及参与路由/查询/排序/统计的字段必须进入关系型列；只有协议私有原始详情、大体积正文和真正开放的扩展数据才使用 JSON/KV。
- v0.3 MVP 只暴露一个逻辑模型 `auto`；ProviderModel 通过 `scheduling_policies` 绑定到该逻辑模型，绑定行保存候选顺序、权重和启用状态。后续每个逻辑模型都可以配置自己的 ProviderModel 绑定和顺序；多逻辑模型属于 P2。
- 手动切换只影响后续新请求，不中断已经开始的请求。
- 请求日志分为稳定元数据、远端尝试记录和可选正文内容三层；正文记录默认关闭，敏感信息必须脱敏。

## 二、实施计划（从头实施）

按依赖顺序分阶段落地，每阶段完成后通过 `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 验证。

### 阶段 1：数据库新基线

- [ ] 按 data-model.md 重建 schema：v0.3 初始化 16 张核心表（含 request_usages），CHECK 约束、端点唯一约束、UNIQUE(requestId, attemptIndex)、partial unique index (providerId, modelName) WHERE deletedTime IS NULL；调度顺序和启用状态存储在 LogicalModel-ProviderModel 绑定表
- [ ] `settings` 初始化使用 INSERT OR IGNORE 幂等写入
- [ ] `provider_health` 随 Provider 创建、`provider_model_health` 随 ProviderModel 创建，在同事务中插入
- [ ] 初始化时幂等创建唯一启用的 `logical_models.auto` 及其 `scheduling_policies`（`priority` + failover）
- [ ] `request_contents` 请求级和尝试级正文结构（通过可空 attemptId 关联）+ conversions
- [ ] 删除旧迁移，建立全新初始化基线（不兼容旧版数据库）
- [ ] store 层 CRUD 与 Zod Schema 对齐新表结构

### 阶段 2：代理管线重构

按 proxy.md「实施说明」五步执行，旧 handler 拆分后删除：

- [ ] 搭建共享骨架：handler 编排（候选路由、尝试循环、手动切换）、transport 纯 I/O（空闲超时、中止、SSE 解析）、hooks 观测订阅
- [ ] 实现 ProtocolAdapter 接口（buildProviderRequest / createResponsePipeline / classifyError）
- [ ] 落地 openai、anthropic、gemini 三个协议适配器（protocols/ 目录）
- [ ] conversions/ 注册表承接协议转换（端点绑定级开关，默认关闭）
- [ ] usage 提取、日志写入收敛到 hooks 订阅者，handler 不再内联
- [ ] `/v1/models` 仅返回 MVP 唯一逻辑模型 `auto`

### 阶段 3：管理 API 与控制台

- [ ] providers / provider-model / settings / request-log 管理接口对齐新数据模型，并统一旧版 upstream-model、logs 路径的替换边界
- [ ] 控制台页面适配新接口与字段
- [ ] `scheduling_policies` 随 `auto` 初始化，路由读取 `priority` 策略并在 `failoverEnabled = false` 时只尝试起始 ProviderModel
- [ ] 日志清理（按数量 + 按天）在新表结构上验证

### 阶段 4：MVP 功能验收

即第三章 MVP（P0）全部条目。

## 三、新版本功能待办

### MVP（P0）：核心代理验收

#### 1. 基础代理验证

- [ ] 启动应用后，本地端口可访问
- [ ] 所有工具统一配置 Base URL 为 `http://127.0.0.1:port`，无需按协议区分
- [ ] OpenAI 工具请求 `/v1/chat/completions`，代理自动识别为 openai 协议并透传到当前逻辑模型的对应 ProviderModel
- [ ] Anthropic 工具请求 `/v1/messages`，代理自动识别为 anthropic 协议并透传到当前逻辑模型的对应 ProviderModel
- [ ] Gemini 工具请求 `/v1beta/models/*`，代理自动识别为 gemini 协议并透传到当前逻辑模型的对应 ProviderModel
- [ ] 请求 `/v1/models` 返回唯一启用的 `auto`，不透传到上游
- [ ] 请求体 `model` 缺失或不为 `auto` 时返回明确的模型参数错误
- [ ] 流式请求能持续返回 SSE 数据，不被代理缓冲破坏
- [ ] 多工具并发请求时，日志记录和健康状态更新无错乱

#### 2. 自动切换队列验证

- [ ] 队列中只有 openai 协议的项；通过 anthropic 协议请求时，返回"当前协议下无可用 ProviderModel"
- [ ] 队列中同时有 openai 和 anthropic 的项；通过 openai 请求时只尝试 openai 项，通过 anthropic 请求时只尝试 anthropic 项
- [ ] 请求体中 `model` 字段为 `auto` 时，转发到远端后被替换为当前队列项的 `modelName`；缺失或其他值按模型参数错误拒绝
- [ ] 队列第一项失败（不可达），自动切换到第二项并成功返回

#### 3. 错误分类与自动切换验证

- [ ] 队列第一项不可达（网络错误），自动切换到第二项并成功返回
- [ ] 队列第一项返回 429 或 500，自动切换到第二项
- [ ] 队列第一项返回 401，切换并在控制台提示该 Provider 鉴权可能异常
- [ ] 上游返回 400 请求错误时，不切换，直接返回客户端错误

#### 4. 手动切换验证

- [ ] 在控制台手动切换到队列第二项，新发起的请求从第二项开始尝试
- [ ] 手动切换时，正在进行的流式请求不中断，继续使用原 ProviderModel 完成
- [ ] 手动切换到的 ProviderModel 失败后，仍按队列顺序自动往下切换
- [ ] 手动切换不改变队列的优先级顺序
- [ ] 重启应用后，当前手动指定的 ProviderModel 重置为队列第一项

#### 5. 流式边界验证

- [ ] 上游在响应头前失败，自动切换
- [ ] 上游已经返回 200 和部分 SSE 后断开，不切换到其他供应商，记录失败

#### 6. 健康状态验证

- [ ] 连续失败达到阈值后供应商进入冷却，后续请求跳过它
- [ ] Provider 级 401/403、端点级认证失败和明确的 Provider 网络故障更新 Provider 健康；模型不存在/模型级 4xx 更新 ProviderModel 健康
- [ ] 429 的健康归属按错误响应可判定范围记录：Provider 明确限流时更新 Provider，否则更新 ProviderModel
- [ ] 冷却结束后，新请求允许再次尝试该供应商
- [ ] 成功请求后连续失败计数重置

#### 7. 安全与隐私验证

- [ ] 服务默认只监听 `127.0.0.1`
- [ ] 代理服务和管理服务分别执行 Host 头校验，拒绝不允许的 Host，覆盖 DNS rebinding 测试
- [ ] 若启用本地 Bearer Token，代理和管理 API 按明确配置边界校验 Token；Token 只存系统密钥环，并覆盖生成、轮换、删除和失效测试
- [ ] 导出配置时 API Key 已脱敏
- [ ] 本地日志中不出现明文密钥；正文记录关闭时不保存完整请求体和响应体
- [ ] 关闭应用后代理端口释放
- [ ] 开机自启设置生效

#### 8. 跨平台验证

- [ ] macOS 菜单栏图标、菜单和控制台可用
- [ ] Windows 托盘图标、菜单和控制台可用

### MVP（P0）：请求正文调试能力

- [ ] 代理链路采集客户端请求和最终响应正文
- [ ] 在 `request_contents` 中按 `attemptId` 采集每次上游尝试的请求、响应和错误正文
- [ ] 采集协议转换前后的请求/响应内容
- [ ] 实现 `/api/request-log/content/get` 查询接口
- [ ] 增加 `RequestContentSchema` 和正文 CRUD/映射逻辑
- [ ] 在日志详情 Drawer/Dialog 中展示完整正文、转换前后内容和上游尝试
- [ ] 验证正文记录关闭时不写入完整请求体和响应体
- [ ] 验证敏感 Header 在入库和展示前均已脱敏

### MVP（P0）：供应商连通性测试

- [ ] Provider 配置页提供“测试连接”入口，向上游发送最小请求验证可用性
- [ ] 测试结果展示成功/失败及错误原因（鉴权失败、网络不可达、超时等）

## P1

### 范围

- 日志筛选（按状态、逻辑模型、供应商、时间）与请求 ID 贯穿，优先于协议转换器落地
- 冷却/熔断状态可视化：队列页展示“冷却中（剩余时间）/ 连续失败次数”徽标，让自动切换可解释
- 配置备份/恢复：导出脱敏配置文件（密钥仅存系统密钥环，提示用户单独备份或重输）
- Token 用量统计：按 `request_usages.type` 聚合展示今日/本周用量（不做费用预估）
- 协议兼容转换器（详见 [protocol-conversion.md](./protocol-conversion.md)）：端点绑定级转换开关、anthropic-messages ↔ openai-completions、openai-responses → openai-completions 三个方向、流式 SSE 转换、队列页转换徽标
- Linux 打包与托盘体验完善
- 更细粒度的错误切换策略配置
- 日志导出
- 可选本地访问 Token

## P2

### 范围

- 请求级路由解释：日志详情展示候选队列快照与每项被跳过的原因（协议不匹配/冷却中/已禁用）
- 多逻辑模型支持（模型列表、模型别名、按逻辑模型配置独立候选池；`auto` 作为默认聚合模型）
- 更多协议路径预设（Ollama 本地、OpenRouter、Azure 等）
- 按延迟、成功率、权重或成本的智能路由
- 主动健康探测
- 多配置 Profile
- 本地 CLI 或无头模式
