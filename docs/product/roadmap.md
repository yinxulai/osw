# 版本规划与验收标准

本文分为“设计定稿”和“功能待办”两部分。当前实现状态以本文件为最终路线图；仍在执行的工程收尾细节以当前 `main` 分支工程待办为准。新版本按定稿 product 目录从头实施，不以兼容旧代码为目标。

## 一、设计定稿（已完成）

以下设计文档已评审定稿，是后续实施的唯一依据。v0.3 已按不兼容的新版本契约实施：22 张表数据库基线（现为配置库与观测库两个文件，见 [data-model.md](./data-model.md) §2.1）、公共 Schema、分域 Store、关系模型管理、核心路由、协议适配器、请求观测和管理界面已经完成；当前主要收尾协议转换补充验收、跨平台和正式发布包端到端验证。

当前实现进度：Provider 默认端点已从 Provider JSON 完全迁移到 `provider_endpoints`；ProviderModel 通过端点绑定和 `scheduling_policies` 参与路由；Provider 与 ProviderModel 双层健康冷却已接入候选过滤和请求尝试。

- [x] [data-model.md](./data-model.md)：22 张核心表基线，含 provider_settings、provider_endpoints、provider_model_endpoints、provider_model_health、scheduling_policies、protocol_converters、request_rewrite_rules、provider_model_request_rewrite_rules、workflows、request_logs、request_attributes、request_usages、attempt_usages、request_attempts、request_contents、attempt_contents、runtime_logs；采用标准字段结构化列、多值关系表、受限 JSON 正文/协议详情、请求观测分层、软删除和 Unix 毫秒时间戳。
- [x] [proxy.md](./proxy.md)（外部行为契约）、[proxy-engine.md](./proxy-engine.md)（分层引擎）：代理管线按入口 → 路由 → 尝试规划 → 尝试执行 → 协议/适配 → 传输 → 响应产出 → 观测分层。
- [x] [protocol-conversion.md](./protocol-conversion.md)、[server-architecture.md](./server-architecture.md)、[tech-architecture.md](./tech-architecture.md)、[security-privacy.md](./security-privacy.md)、[observability.md](./observability.md)、[telemetry.md](./telemetry.md)。

### 当前实现结论

- v0.3 的数据库基线、关系模型、分域 Store、路由、协议适配器、请求观测分层、管理 API 和控制台主流程已落地。
- 请求链路统一使用 `client*` / `upstream*` 边界：`clientProtocol` 表示客户端协议，`request_attempts.upstreamProtocol` 表示每次真实远端尝试；正文按视角拆为 `request_contents`（客户端）与 `attempt_contents`（上游）。
- 观测数据遵循两条硬约束：**一张表 = 一个视角**（列名不带视角前缀，用量同样拆为 `request_usages` / `attempt_usages`，不用可空列判别归属）；**事实永远写入、载荷才受开关控制**（协议转换由两侧协议对比得出而不单独建表，是否流式、TTFT、命中的改写规则 id 与尝试级原始 usage 写在 `request_attempts` 上，`captureRequestContent` 关闭时依然完整落库）。
- 完整源码验证已通过：`pnpm typecheck`、`pnpm test`、`pnpm lint`；Vite bundling 也已通过。
- Windows electron-builder 当前受符号链接权限限制，发布包安装验证仍未完成；该环境问题不改变源码验证结论。

### 产品与设计原则（摘要）

- 身份、关系、枚举、开关、数值以及参与路由/查询/排序/统计的字段必须进入关系型列；只有协议私有原始详情、大体积正文和真正开放的扩展数据才使用 JSON/KV。
- v0.3 MVP 只暴露一个兜底逻辑模型 `default`；所有未匹配的非空客户端模型名都由它处理。ProviderModel 通过 `scheduling_policies` 绑定到该逻辑模型，绑定行保存候选顺序、权重和启用状态。后续每个逻辑模型都可以配置自己的 ProviderModel 绑定和顺序；多逻辑模型属于 P2。
- 手动切换只影响后续新请求，不中断已经开始的请求。
- 请求日志分为稳定元数据、远端尝试记录和正文内容三层；正文记录默认开启、可由用户关闭，敏感 Header 必须脱敏，正文不限制大小并完整保存。

## 二、新版本功能待办

### MVP（P0）：核心代理验收

#### 1. 基础代理验证

- [x] 启动应用后，本地端口可访问
- [x] 所有工具统一配置 Base URL 为 `http://127.0.0.1:port`，无需按协议区分
- [x] OpenAI 工具请求 `/v1/chat/completions`，代理自动识别为 openai 协议并透传到当前逻辑模型的对应 ProviderModel
- [x] Anthropic 工具请求 `/v1/messages`，代理自动识别为 anthropic 协议并透传到当前逻辑模型的对应 ProviderModel
- 暂不支持：Gemini `/v1beta/models/*` 协议代理
- [x] 请求 `/v1/models` 返回唯一启用的 `default`，不透传到上游
- [x] 请求体 `model` 缺失、空值或非字符串时返回明确的模型参数错误；任意其他非空模型名由 `default` 处理
- [x] 流式请求能持续返回 SSE 数据，不被代理缓冲破坏
- [x] 多工具并发请求时，日志记录和健康状态更新无错乱

#### 2. 自动切换候选验证

- [x] 候选列表中只有 openai 协议的项；通过 anthropic 协议请求时，返回"当前协议下无可用 ProviderModel"
- [x] 候选列表中同时有 openai 和 anthropic 的项；通过 openai 请求时只尝试 openai 项，通过 anthropic 请求时只尝试 anthropic 项
- [x] 请求体中任意非空 `model` 字段都会由 `default` 逻辑模型处理，转发到远端后被替换为当前候选的 `modelName`
- [x] 候选第一项失败（不可达），自动切换到第二项并成功返回

#### 3. 错误分类与自动切换验证

- [x] 候选第一项不可达（网络错误），自动切换到第二项并成功返回
- [x] 候选第一项返回 429 或 500，自动切换到第二项
- [x] 候选第一项返回 401，切换并在控制台提示该 Provider 鉴权可能异常
- [x] 上游返回 400 / 422 时先切换候选；全部候选都判定请求不成立时，回该 4xx（而不是 502），让客户端能据此修正请求

#### 4. 手动切换验证

- [x] 在控制台手动切换到候选第二项，新发起的请求从第二项开始尝试
- [x] 手动切换时，正在进行的流式请求不中断，继续使用原 ProviderModel 完成
- [x] 手动切换到的 ProviderModel 失败后，仍按候选顺序自动往下切换
- [x] 手动切换不改变候选的优先级顺序
- [x] 重启应用后，当前手动指定的 ProviderModel 重置为候选第一项

#### 5. 流式边界验证

- [x] 上游在响应头前失败，自动切换
- [x] 上游已经返回 200 和部分 SSE 后断开，不切换到其他供应商，记录失败

#### 6. 健康状态验证

- [x] 连续失败达到阈值后供应商进入冷却，后续请求跳过它
- [x] Provider 级 401/403、端点级认证失败和明确的 Provider 网络故障更新 Provider 健康；模型不存在/模型级 4xx 更新 ProviderModel 健康
- [x] 429 的健康归属按错误响应可判定范围记录：Provider 明确限流时更新 Provider，否则更新 ProviderModel
- [x] 冷却结束后，新请求允许再次尝试该供应商
- [x] 成功请求后连续失败计数重置

#### 7. 安全与隐私验证

- [x] 服务默认只监听 `127.0.0.1`
- [x] 网络可达性由监听地址与操作系统防火墙负责：`listenHost` 可由用户改为 `0.0.0.0` / `::` 以暴露给局域网 / WSL / 容器，**不做 Host 头白名单校验**（原「拒绝不允许的 Host」条目已按此决策撤销，见 [security-privacy.md](./security-privacy.md)）
- [x] 若启用本地 Bearer Token，代理和管理 API 按明确配置边界校验 Token；Token 只存系统密钥环，并覆盖生成、轮换、删除和失效测试
- [x] 导出供应商包时 API Key 默认脱敏（包含明文需显式勾选并提示）
- [x] 本地日志中不出现明文密钥；正文记录关闭时不保存完整请求体和响应体
- [x] 关闭应用后代理端口释放
- [x] 开机自启设置生效

#### 8. 跨平台验证

代码已就位（`apps/app/source/tray-manager.ts` / `tray-menu.ts` / `tray-icon.ts`，含 `tray-manager.test.ts` 单测），以下条目待真机逐条验收。

- [ ] macOS 菜单栏图标、菜单和控制台可用
- [ ] Windows 托盘图标、菜单和控制台可用

### MVP（P0）：请求正文调试能力

- [x] 代理链路采集客户端请求和最终响应正文
- [x] 在 `attempt_contents` 中按 `attemptId` 采集每次上游尝试的请求、响应和错误正文（客户端侧正文在 `request_contents`）
- [x] 采集协议转换前后的请求/响应内容
- [x] 通过 `/api/request-log/detail` 按需查询 request-level 与 attempt-level 摘要，正文由 `/api/request-log/bodies` 在用户查看或复制时单独取回
- [x] 增加 `RequestContentSchema` 和正文 CRUD/映射逻辑
- [x] 在日志详情中展示完整正文、转换前后内容和上游尝试
- [x] 验证正文记录关闭时不写入完整请求体和响应体
- [x] 验证敏感 Header 在入库和展示前均已脱敏
- [x] 请求与响应正文全量保存；流式记录保存全部原始 chunk，不聚合或截断，存储占用通过手动清理和自动保留策略控制
- [x] 采集与保留拆成两个独立维度：`captureRequestLogs` / `captureRequestContent` 各一个开关，`requestLogRetentionDays`（默认 `0`，永久）与 `contentRetentionDays`（默认 `7` 天）各一个时间窗
- [x] 删除语义分层：请求日志过期级联删除正文/尝试/用量，正文过期只删正文并保留请求行与指标；正文被清理的记录在详情中显式提示
- [x] “清理历史日志”支持分别输入请求日志与请求响应正文的保留天数并立即执行，不改动自动保留设置
- [x] 请求日志每条记录支持复制完整 cURL（含正文，无损转义）

### MVP（P0）：供应商连通性测试

- [x] 模型管理页提供“连接测试”入口，向上游发送最小请求验证可用性
- [x] 测试结果展示成功/失败及错误原因（鉴权失败、网络不可达、超时等）
- [x] 渠道诊断面板重做：进度与结果统计常驻、失败过滤与重试失败、清空结果、真实 token 用量（无数据显 `—`）
- [x] 诊断请求的载荷按协议对齐：OpenAI 协议不带输出上限，Anthropic 直连补最小 `max_tokens`（避免转换层默认 4096 带来的成本）
- [x] 客户端中止诊断时正常收尾并返回已完成的尝试结果，不再出现无响应

### MVP（P0）：代理管线收尾

- [x] 抽出基础传输层（现为 `proxy/transports/http.ts`），隔离 Node.js HTTP/HTTPS 请求调用并覆盖基础测试
- [x] 建立共享 request context，统一请求 ID、协议、取消信号和生命周期数据
- [x] 建立 ProtocolAdapter 类型、注册表与 OpenAI Completions、OpenAI Responses、Anthropic Messages 适配边界
- [x] 将模型改写、usage 注入、请求/响应转换和流式转换迁移到 adapter 或转换器注册表
- [x] 将超时、客户端中止、SSE 和响应头生命周期下沉到 transport
- [x] 明确并完成 attempt、usage 和正文采集 hooks 与持久化 logger 的责任边界
- [x] 收敛请求入口和尝试编排，使其负责候选编排、尝试循环、错误分类和生命周期收尾

### MVP（P0）：正式发布验收

- [x] `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 和 Vite bundling 已通过
- [x] 发布包已在 macOS（arm64）生成 DMG/zip 并通过 ad-hoc 签名校验；三平台打包由 release workflow 的构建矩阵覆盖，本机 Windows 直接跑 electron-builder 仍受符号链接权限限制（需开发者模式或管理员终端）
- [ ] 使用全新用户数据目录完成发布包首次启动和空数据库初始化
- [ ] 在发布包内完成 Provider 配置、OpenAI/Anthropic 请求、故障转移、日志与正文查看端到端验收
- [ ] 完成 macOS arm64/x64 菜单栏、菜单、控制台、开机自启和退出验收
- [ ] 完成 Windows x64 构建及安装、托盘、控制台和退出验收
- [ ] 清理旧测试术语和过时文档状态
- [ ] 更新正式版本号、发布说明与更新元数据

## P1

### 国际化（i18n）

完整设计见 [i18n.md](./i18n.md)。核心约束：**界面文案可切换语言，日志与错误固定英文。** 阶段 1 为硬需求。

- [x] 阶段 0：`SettingsSchema` 增 `language`、i18n 核心、目录骨架、`I18nProvider`、设置页语言行
- [x] 阶段 1：日志与错误英文化（`errors.ts`、管理 API、代理层、运行日志），错误码收窄为 `ApiErrorCode`，渲染层按错误码本地化
- [x] 阶段 2：外壳与通用组件（侧栏、layout、设置页、通用表单 / 列表状态）
- [x] 阶段 3：业务页逐页迁移（overview / request-logs / logs / logical-models / model-management / router / request-rewrite-rules / access-config）
- [x] 阶段 4：原生托盘 / 菜单 / 对话框本地化
- [x] 阶段 5：门禁与清理（`no-hardcoded-cjk` ESLint 规则、目录一致性检查、移除硬编码中文）

> 实施状态以 [i18n.md](./i18n.md) §8 为准：六个阶段全部落地（en / zh-CN 双目录、`no-hardcoded-cjk` 已接入 `pnpm lint`、目录一致性由 `catalogs.test.ts` 兜底）。

### 范围

- [x] 日志筛选已支持状态、逻辑模型、协议、供应商和时间范围，并保持 list/count 条件一致；请求 ID 贯穿仍待补齐
- [x] 冷却/熔断状态可视化：逻辑模型页展示冷却状态与连续失败次数徽标
- [x] 供应商包备份/恢复：按供应商导出/导入端点、模型与自定义设置，密钥仅存系统密钥环
- [x] Token 用量统计：按 `request_usages.type` 聚合展示今日/本周用量（overview 的 `range` 已支持 `today` / `7d` / `30d`，统计卡与趋势图按 `request_usages.type` 拆分输入 / 输出 / 推理 / 缓存读写，见 `analytics-store.ts` 的 usage pivot）
- [ ] 协议兼容转换器补充验收（详见 [protocol-conversion.md](./protocol-conversion.md) 验收清单）：三个方向的转换器、`ToolNameRegistry` 可逆展平、custom 工具往返、转换候选故障切换与 400/502 语义、流式收尾均已落地并有单测（协议转换 196 例）；剩余全部是**真实供应商人工回归**——含命名空间工具寻址、custom 工具全链路与流式事件名复核
- [x] 代理引擎（设计详见 [proxy-engine.md](./proxy-engine.md)）：协议矩阵收敛到单一描述符注册表，内核没有协议与 HTTP 分支，重写/转换/日志/用量/健康落位为 Modifier 与 Observer 插件；双向传输能力预留在内核，当前没有实现、也不在计划内
- [x] 上游出站代理设置（详见 [outbound-proxy.md](./outbound-proxy.md)）：HTTP/HTTPS/SOCKS 代理、绕过规则、草稿连接测试，覆盖模型请求与模型列表获取
- Linux 打包与托盘体验完善
- 更细粒度的错误切换策略配置
- [x] 日志导出

## P2

### 请求重写模块

行为契约、实现状态与剩余项：[request-rewrite-rules.md](./request-rewrite-rules.md)（§12 分阶段实施状态）

- [x] 规则模型已冻结并实现：全局规则与 ProviderModel 绑定、绑定顺序（`priority`）、启停，以及「失败即阻断当前 attempt」语义
- [x] 请求阶段动作与非流式响应阶段动作已生效；`stage` 是动作级字段，不是匹配条件
- [x] Header 动作、受限 JSON Path 动作与 `User-Agent` 场景已落地
- [ ] 三种协议的 thinking/reasoning 字段矩阵，以及 OpenAI Responses、Anthropic Messages 的人工验收（**部分实现**：Responses `reasoning.effort` ↔ Chat `reasoning_effort` 与用量层 `reasoning_tokens` 已映射；Anthropic `thinking` / `thinking_delta` 当前双向丢弃，完整字段矩阵与人工验收未做，见 [request-rewrite-rules.md](./request-rewrite-rules.md) §5.4）
- [ ] 请求日志中的规则执行摘要与响应字段修改安全审计（**部分实现**：`request_attempts.requestRewriteRuleIds` / `responseRewriteRuleIds` 已落库并在请求详情展示规则名，粒度只到规则 ID 列表；响应字段修改的安全审计未做，见 [request-rewrite-rules.md](./request-rewrite-rules.md) §12）
- [ ] 流式事件级规则（仅在独立设计评审通过后实施）

### 匿名使用统计

默认关闭的匿名使用统计：事件白名单、匿名标识口径、上报链路与分析口径见 [telemetry.md](./telemetry.md)。

**状态：客户端上报已下线（2026-09）。** 在 apis（`apps/apis/` Worker）下游方案定稿前，客户端侧实现（core 上报链路、`SettingsSchema` 统计字段、管理接口、控制台开关与预览卡片、引导同意步骤及相关 i18n）已整体移除；仅保留契约层 `packages/contracts/source/telemetry.ts` 与 `apps/apis/` Worker。重新落地前需先解决 telemetry.md §6 / §8.3 记录的下游问题。

- [x] 设计定稿：事件目录（13 个事件）、公共字段、稳定不轮换的 `installId` 与保留期取舍、端点恒定与后端可换、首版只对接 GA4（不自建存储）、Worker 职责与 GA 能力边界、分析口径
- [ ] **（暂缓）** 客户端上报链路：`SettingsSchema` 统计字段、core 安装标识 / 队列 / 直连连接器与生命周期接线、宿主注入版本、管理接口预告报文、控制台开关与预览卡片、引导页同意步骤 —— 已移除，待下游方案定稿后重新设计
- [ ] `packages/contracts/source/telemetry.ts`：事件名闭集、属性枚举与长度约束、端点常量（保留）
- [ ] `apps/apis/`：严格校验、白名单削平、把真实客户端 IP 作为 `ip_override` 交给 GA 解析地理位置、限流、单批 25 条硬上限、转发 GA4 Measurement Protocol
- [ ] `apps/apis/` 自动部署：push 到 `main` 且 `apps/apis/**` 变更时发布，支持手动触发

### 范围

- 请求级路由解释：日志详情展示候选列表快照与每项被跳过的原因（协议不匹配/冷却中/已禁用）
- 多逻辑模型支持（模型列表、模型别名、按逻辑模型配置独立候选池；`default` 作为默认聚合模型）
- 更多协议路径预设（Ollama 本地、OpenRouter、Azure 等）
- 按延迟、成功率、权重或成本的智能路由
- 主动健康探测
- 多配置 Profile
- 本地 CLI 或无头模式（设计、包边界与阶段验收见 [packaging.md](./packaging.md)，进度见下文「工程演进」）

## 工程演进：包拆分与多形态分发（S0–S4）

目标是把核心能力拆成包，让同一套能力同时服务 CLI 与桌面 App 两种形态。设计、包边界、目录映射与宿主适配点以 [packaging.md](./packaging.md) 为唯一权威；本节的勾选状态是该计划的进度来源。

- [x] S0 搬目录与配置：建立 pnpm workspace 与 `packages/{contracts,core,console}` + `apps/app` 宿主壳；目录名统一为 `source/`，脚本按业务归入各包 `scripts/`（跨包收在 `packages/toolkit/scripts/`），打包资产按「谁用谁持有」进 `apps/app/`，turbo 接管任务编排。
- [ ] S1 `core` 可独立运行：`core` / `contracts` 产出独立构建产物 + 裸 Node 冒烟脚本。**跳过**：CLI 直接用 Vite 别名打包 `core` / `contracts` 的源码，不消费它们的独立产物，因此没有驱动它的需求；留到真有第三方单独消费 `core` 时再做。
- [x] S2 CLI 成型：落地 §5.1–§5.5 五项宿主适配，建立 `apps/cli` 并实现 `start` / `stop` / `status` / `version`。**未包含**：`config` 子命令、`--daemon`、发布形态。
- [x] S2.1 CLI 生产级细节：单实例互斥（`instance.lock`）与崩溃兜底、`status --json`、端口/版本漂移诊断、非回环监听告警、9 步真实子进程冒烟脚本 `pnpm smoke:cli`。
- [x] S2.2 两种形态的一致性：同一套服务、同一份数据，差别只在「怎么把它起来」。数据目录名唯一取自 `runtimeProfile.dataDirectoryName`；两个形态的密钥文件分开命名（密文算法不同，同名会让后写的把前一份全部作废）；「一致 / 能力差异 / 形态差异」三类逐项列清（[packaging.md](./packaging.md) §6）。
- [x] S2.3 数据落用户主目录 + 两库拆分：数据目录改为 `<用户主目录>/.osw`（开发档 `~/.osw-development`）；原先的单一数据库拆成 `config-<n>.db` / `data-<n>.db`，两份 schema、两条 Drizzle 链，跨库外键全部移除（健康行惰性创建 + 启动时清理孤儿行），文件名版本号改用各库自己的 schema 版本常量，新增库边界守卫 `check-database-boundaries.mjs`。**不考虑兼容与历史**：拆分当时不做数据搬迁，换代（换文件名）只用于大版本发布，日常结构变化追加迁移。
- [x] S2.4 宿主与实例身份收口：把只在某一个宿主/某一条路径上成立的保证收进 core——实例互斥移到 `packages/core/source/runtime/instance-lock.ts` 并由 `startServer` 在绑定端口前取锁（存活判定为「pid 活着且心跳新鲜」）；代理侧修失败归因（双向形态不符、流中途截断）、观察者隔离、下游背压、`accept-encoding` 协商与协议固定头丢失，并把请求头改成**默认转发**（只动鉴权头、逐跳头、与位置绑定的 `host`/`content-length` 和 `accept-encoding`，协议固定头分「该覆盖」与「只补缺」两半）；控制台修查询键撞车、监听器泄漏与加载失败静默。
- [x] S2.5 管理接口去鉴权 + 拆掉专门加的校验：管理接口撤掉实例 Token（`runtime-identity.ts` 删除），边界只剩回环监听与来源白名单；`node:sqlite` 的产物级断言删除，`external` 固定为 `[...builtinModules, /^node:/]`；`typecheck.mjs` 的 `include` 前置检查删除。保留三个 `check-*` 边界守卫与 `version.mjs --check`（声明式规则表，验的是架构约束而非某次构建的输出）。
- [ ] S3 App 回归：`apps/app/source` 按 §4.1 拆出 `main/` 与 `preload/` 并复核构建产物映射（`electron-builder` 配置与打包脚本已归 `apps/app/`）；托盘 / 自动更新 / 开机自启 / 原生对话框保持。验收：桌面安装包端到端可用且升级路径不回归。
- [ ] S4 分发与文档：CLI 以 npm 全局 bin 分发并声明 `engines`。**当前明确不发布**，`bin` 已就位但 `private: true` 未摘。

已落地的工程前置：包边界守卫 `packages/toolkit/scripts/check-package-boundaries.mjs`（随 `pnpm lint` 执行）强制 `packages/*` 与 `apps/*` 之间的依赖方向；`RULES.cli` 禁止 CLI 依赖 `console` 与 `app`、禁止 `electron`。
