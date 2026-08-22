# JSX 结构优化计划

> 状态：代码结构重构已完成；仅保留人工页面回归待执行
> 范围：`source/render/source/**/*.tsx`
> 目标：拆解超长、嵌套条件复杂、在 JSX 内混合数据计算与多重循环的渲染树，使页面和容器组件最终只负责清晰组合。

## 1. 背景与问题

当前 Render 层已经完成 API、状态与页面服务分域，但部分 JSX 仍保留早期的集中式写法，主要表现为：

- 单个 `return` 同时承载多个完整视觉区域；
- JSX 内出现嵌套三元运算符；
- `map` 内继续执行 `filter`、状态计算和多层条件渲染；
- loading、empty、content 等页面状态直接嵌套在大型表达式中；
- 单行 JSX 过长，无法快速识别结构；
- 页面容器同时负责筛选栏、表格、行和详情区域；
- 可命名的业务视觉单元仍以内联 JSX 存在。

本轮只优化渲染结构和可读性，不改变业务状态模型、API 契约、视觉样式或交互行为。

## 2. 拆分原则

### 2.1 使用命名 render 方法

以下情况优先保留在当前组件内，拆为 `renderXxx()`：

- 同一组件互斥的 loading、empty、content 状态；
- 不超过约 30–50 行、无独立状态的局部视觉片段；
- 只依赖当前组件上下文且没有复用价值的 header、footer、table header；
- 为消除嵌套三元而提取的简单状态渲染。

建议命名：

- `renderLoading()`
- `renderEmptyState()`
- `renderContent()`
- `renderTableBody()`
- `renderHeaderActions()`
- `renderDialogFooter()`

render 方法不得包含副作用；复杂筛选、聚合和状态推导应在 JSX 之前完成。

### 2.2 抽取独立组件

满足以下任一条件时，不应只提取 render 方法，而应建立独立组件：

- 具有独立交互，如搜索、展开、抽屉、拖拽、开关或表单；
- 自身包含列表循环；
- 可以用明确领域名称描述，如 `ProviderEndpointCard`；
- JSX 超过约 30–50 行且包含条件逻辑；
- 具有可独立测试或独立迭代的边界；
- 父组件需要向该区域透传多个事件处理器。

避免创建 `Section1`、`ContentBlock` 等无业务含义的组件。

### 2.3 JSX 条件约束

- JSX 内避免嵌套三元；单层且非常短的二选一文本可以保留。
- 三种及以上状态使用命名变量、映射表、render 方法或状态组件。
- 避免在 JSX 内使用 `filter(...).map(...)`；先构建视图模型或索引。
- `map` 回调内避免再声明多项业务计算；应由辅助函数或预计算数据提供。
- 页面主组件应能在几十行内看出完整页面结构。

### 2.4 变更边界

- 不改变组件对外行为和管理 API 调用。
- 不借机重做 UI，不新增阴影或无必要边框。
- 不因拆分引入额外 DOM 层级，避免布局变化。
- 不建立无复用价值的通用组件体系。
- 不把领域逻辑重新塞回页面组件。

## 3. 审计结果

## 3.1 P0：明显复杂，必须拆分

### 3.1.1 `components/model-test-panel.tsx`

问题：

- 单个 Dialog 同时包含标题、供应商/模型/协议三层选择器、测试工具栏、进度和结果表；
- `provider -> model -> protocol` 三层嵌套循环；
- 协议按钮样式存在多层嵌套三元；
- 测试任务行内组合状态、协议、响应、错误等多类显示逻辑；
- JSX 内重复执行 provider/model 筛选与选中数量计算。

目标结构：

```text
ModelTestPanel
├── ModelTestDialogHeader
├── ModelTestSelectionPanel
│   ├── ProviderTestSelector
│   ├── ModelProtocolSelector
│   └── ProtocolTestToggle
├── ModelTestToolbar
├── ModelTestProgress
└── ModelTestTaskTable
    ├── ModelTestTaskRow
    └── ModelTestEmptyState
```

建议提取：

- `getProviderModels()`
- `getProviderSelectedCount()`
- `getTaskStatusLabel()` 或状态映射表
- `ProviderTestSelector`
- `ModelProtocolSelector`
- `ProtocolTestToggle`
- `ModelTestProgress`
- `ModelTestTaskRow`

完成标准：主 `ModelTestPanel` 只保留任务状态编排与 Dialog 区域组合，不再出现三层循环或嵌套三元。

### 3.1.2 `pages/request-logs/page.tsx`

问题：

- 页面同时包含头部、六类筛选、空状态、表头、骨架行、数据行、详情行和分页；
- loading / empty / rows 使用嵌套三元；
- 缓存 Token 单元格存在 null / hit / miss 三层条件；
- 行循环内计算 TPS、展开状态并组合主行和详情行。

目标结构：

```text
RequestLogsPage
├── RequestLogsHeader
├── RequestLogsFilters
└── RequestLogsTable
    ├── RequestLogsTableHeader
    ├── RequestLogsLoadingRows
    ├── RequestLogsEmptyRow
    └── RequestLogTableRow
        ├── CachedTokensCell
        └── RequestLogDetailRow
```

建议提取：

- `RequestLogsFilters`
- `RequestLogsTable`
- `RequestLogTableRow`
- `CachedTokensCell`
- `renderPagination()`

完成标准：页面只组合头部、筛选、表格和分页；表格 body 不再使用嵌套三元。

### 3.1.3 `pages/request-logs/components/request-log-detail-row.tsx`

问题：

- 文件虽已有局部组件，但详情行仍混合标题、指标、上游路由、Usage 和正文抽屉；
- `RequestContents` 同时处理抽屉外壳、loading、error、empty、正文 section 和转换记录；
- 上游尝试列表行仍承担多种状态展示。

目标结构：

```text
RequestLogDetailRow
├── RequestDetailHeader
├── RequestMetricsGrid
├── UpstreamRoute
│   └── UpstreamAttemptRow
├── RawUsage
└── RequestContentsDrawer
    ├── RequestContentsHeader
    ├── RequestContentsState
    └── ContentSection
```

建议优先把 `RequestContents` 移到独立文件，再拆 `UpstreamAttemptRow` 与指标区域。

完成标准：`RequestLogDetailRow` 成为组合容器；正文解析和抽屉状态不再挤在详情行文件中。

### 3.1.4 `pages/model-management/components/model-dialog.tsx`

问题：

- Dialog 混合模型 ID、远程模型搜索、协议端点、覆盖 URL、协议转换和 footer；
- `protocolEntries.map()` 内包含多层 enabled / override / convertible / conversionEnabled 条件；
- 协议转换区具备明确业务边界但仍为内联 JSX。

目标结构：

```text
ModelDialog
├── ModelIdentitySection
│   └── FetchedModelPicker
├── ProtocolEndpointsSection
│   └── ModelProtocolEndpointCard
│       ├── OverrideUrlField
│       └── ProtocolConversionSettings
└── ModelDialogFooter
```

建议提取：

- `FetchedModelPicker`
- `ModelProtocolEndpointCard`
- `ProtocolConversionSettings`
- `renderDialogFooter()`

完成标准：Dialog 主体不直接包含协议端点复杂条件树。

### 3.1.5 `pages/model-management/components/provider-dialog.tsx`

问题：

- 混合供应商预设、基础字段、密钥/超时和协议默认地址；
- 预设与端点列表均在 Dialog 主体内循环；
- endpoint enabled 状态控制整段表单。

目标结构：

```text
ProviderDialog
├── ProviderPresetPicker
├── ProviderBasicFields
├── ProviderEndpointDefaults
│   └── ProviderEndpointCard
└── ProviderDialogFooter
```

完成标准：Dialog 主组件只负责组合表单区段和提交操作。

### 3.1.6 `pages/model-management/components/provider-detail.tsx`

问题：供应商头部、操作区、模型工具栏、拖拽列表、模型行和空状态集中在一个组件。

目标结构：

```text
ProviderDetail
├── ProviderDetailHeader
└── ProviderModelsSection
    ├── ProviderModelsToolbar
    ├── ProviderModelList
    ├── ProviderModelRow
    └── ProviderModelEmptyState
```

完成标准：模型行成为独立组件，父组件不再承载行内操作和显示细节。

## 3.2 P1：优先整理可读性

### 3.2.1 `pages/logs/components/logs-table.tsx`

当前几乎全部 JSX 被压缩成单行，loading、empty、rows 使用嵌套三元。

建议：

- `renderLoadingRows()`
- `renderEmptyRow()`
- `renderLogRows()` 或 `LogTableRow`
- 主 `return` 只组合 table header 与 body。

这是第一批低风险修改对象，可用于建立本轮 render 方法风格。

### 3.2.2 `pages/queue-control/components/queue-list-card.tsx`

问题：Card header、模式切换、表头、DnD 列表和空状态集中；列表循环内计算 cooling 与 selected。

建议：

- `QueueListHeader`
- `renderQueueTable()`
- `renderEmptyState()`
- 在进入 JSX 前构建包含 `cooling`、`selected` 的行视图数据。

已有 `QueueModelRow` 保持独立，不继续过度拆分。

### 3.2.3 `pages/runtime-settings/components/update-card.tsx`

问题：预览状态与桌面更新流程是两套视觉树，并同时处理 checking、downloading、available、downloaded、error 等状态。

建议：

- `renderPreviewCard()`
- `renderVersionInfo()`
- `renderReleaseNotes()`
- `renderDownloadProgress()`
- `UpdateActions`

### 3.2.4 `pages/model-management/page.tsx`

建议仅做页面级整理：

- `renderHeaderActions()`
- `renderLoading()`
- `renderProviderWorkspace()`
- `renderDialogs()`

该页面已有独立 Dialog，不应将其内部逻辑搬回页面。

## 3.3 P2：轻量优化或保持现状

### 可选整理

- `components/app-sidebar.tsx`：把 section 内的 `filter().map()` 改为预分组数据。
- `pages/model-management/components/provider-grid.tsx`：预计算 provider 对应模型索引。
- `App.tsx`：页面分支当前清晰，仅在分支继续增长时增加 `renderActivePage()`。

### 保持现状，可作为模板

- `pages/overview/page.tsx`：已有 `renderLoading`、`renderEmpty`、`renderContent`、`renderBody`。
- `pages/runtime-settings/page.tsx`：已是卡片组合层。
- `pages/queue-control/page.tsx`：已是页面组合层。
- `pages/request-logs/components/request-row.tsx`：职责单一。
- `pages/queue-control/components/queue-model-row.tsx`：状态展示已按职责拆开。
- Runtime Settings 各领域卡片：一张卡片对应一个明确业务域。

## 4. 实施阶段

## 阶段 0：冻结基线

- [x] 执行 `pnpm lint`。
- [x] 执行 `pnpm typecheck`。
- [x] 执行 `pnpm test:server`。
- [x] 执行 `pnpm vite build`。
- [ ] 执行并记录模型管理、诊断面板、请求日志、队列和设置页的手动回归路径。

## 阶段 1：低风险 JSX 可读性

- [x] 重构 `logs-table.tsx`，消除单行 JSX 和嵌套三元。
- [x] 重构 `queue-list-card.tsx`，拆 header、table、empty 状态。
- [x] 整理 `model-management/page.tsx` 的页面状态 render 方法。
- [x] 整理 `app-sidebar.tsx` 的导航预分组。

验收：仅调整结构，不改变 props、事件与 DOM 布局。

## 阶段 2：模型管理表单与详情

- [x] 拆分 `provider-dialog.tsx`。
- [x] 拆分 `model-dialog.tsx`。
- [x] 拆分 `provider-detail.tsx`。
- [x] 保证协议转换、端点启用、URL 覆盖和模型获取行为不变。

推荐新增文件：

```text
pages/model-management/components/
├── provider-preset-picker.tsx
├── provider-endpoint-card.tsx
├── fetched-model-picker.tsx
├── model-protocol-endpoint-card.tsx
├── protocol-conversion-settings.tsx
├── provider-detail-header.tsx
└── provider-model-row.tsx
```

## 阶段 3：请求日志

- [x] 将筛选栏从 `request-logs/page.tsx` 提取为独立组件。
- [x] 将表格及 table body 状态提取为独立组件。
- [x] 将请求主行提取为 `RequestLogTableRow`。
- [x] 将缓存 Token 三态提取为 `CachedTokensCell`。
- [x] 将正文抽屉从 `request-log-detail-row.tsx` 移出。
- [x] 拆分上游 Attempt 行和指标网格。

推荐结构：

```text
pages/request-logs/components/
├── request-logs-filters.tsx
├── request-logs-table.tsx
├── request-log-table-row.tsx
├── cached-tokens-cell.tsx
├── request-log-detail-row.tsx
├── request-contents-drawer.tsx
├── upstream-route.tsx
└── request-metrics-grid.tsx
```

## 阶段 4：诊断面板

- [x] 诊断面板已完成领域组件拆分；维持同文件组织，不再以迁移到 `components/model-test/` 作为完成条件。
- [x] 拆供应商、模型和协议选择区域。
- [x] 消除协议按钮嵌套样式三元，使用命名状态样式函数。
- [x] 拆测试工具栏、进度与任务结果行。
- [x] 把 provider/model/protocol 视图计算移出 JSX。
- [x] 保留测试并发和任务状态更新逻辑的原有行为。

推荐结构：

```text
components/model-test/
├── model-test-panel.tsx
├── provider-test-selector.tsx
├── model-protocol-selector.tsx
├── protocol-test-toggle.tsx
├── model-test-toolbar.tsx
├── model-test-progress.tsx
├── model-test-task-table.tsx
└── model-test-task-row.tsx
```

## 阶段 5：更新卡片与全局收尾

- [x] 整理 `update-card.tsx` 的互斥状态和操作区。
- [x] 搜索剩余嵌套三元和超长 JSX。
- [x] 搜索 JSX 内 `filter().map()` 和多层 `map()`。
- [x] 删除重构后无用的 import、辅助变量和旧组件出口。
- [x] 更新本计划完成状态。

## 5. 验收标准

### 5.1 结构验收

- 页面主组件的 `return` 主要负责组合。
- JSX 内无明显嵌套三元。
- provider/model/protocol 等多层循环不出现在页面或 Dialog 主组件中。
- loading、empty、content 等互斥状态具有明确命名。
- 复杂计算和集合筛选在 JSX 之前完成。
- render 方法保持短小、无副作用。
- 独立交互单元使用领域组件，不以巨大 render 方法替代组件边界。

### 5.2 行为验收

#### 模型管理

- [ ] 新建、编辑和删除供应商正常。
- [ ] 供应商预设、API Key、超时和端点开关正常。
- [ ] 新建、编辑和删除模型正常。
- [ ] 获取并搜索上游模型正常。
- [ ] 覆盖端点 URL、协议转换开关和转换方向正常。
- [ ] 拖拽模型优先级正常。

#### 请求日志

- [ ] 筛选、日期范围、分页和刷新正常。
- [ ] 主行展开与详情加载正常。
- [ ] loading、error、empty 状态正常。
- [ ] 上游尝试、Usage 和正文抽屉正常。
- [ ] JSON 格式化、转换前后正文和复制正常。

#### 诊断面板

- [ ] 全选、渠道、模型和协议选择状态正确。
- [ ] 原生协议与转换协议样式和提示正确。
- [ ] 测试并发仍受 `TEST_CONCURRENCY` 限制。
- [ ] running 时关闭和修改选择仍被正确限制。
- [ ] 进度、成功、失败、响应耗时和错误信息正确。

#### 队列与设置

- [ ] 队列自动/手动模式、拖拽和启停正常。
- [ ] 更新检查、下载进度、错误和安装操作正常。

### 5.3 视觉与质量验收

- [x] 不改变现有颜色、间距、响应式布局。
- [x] 不新增无必要阴影或边框。
- [x] 不因抽组件增加影响布局的 DOM 包装层。
- [x] `pnpm lint` 通过。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test:server` 通过。
- [x] `pnpm vite build` 通过。
- [ ] 对受影响页面进行桌面端和窄窗口人工回归。

## 6. 推荐执行顺序

```text
logs-table
→ queue-list-card
→ model-management 页面组合
→ provider-dialog
→ model-dialog
→ provider-detail
→ request-logs filters/table/row
→ request-log detail/contents
→ model-test-panel
→ update-card
→ 全仓 JSX 残留扫描与回归
```

先通过低风险文件确立 render 方法和组件命名规范，再处理模型表单与请求日志，最后处理状态和交互耦合最重的诊断面板。
