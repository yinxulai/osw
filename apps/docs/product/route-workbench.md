# 路由工作台

> 工作台的**交互设计**与**画布侧组件结构**在本文件维护，覆盖的是**工作流图模式**的画布；规则模式的模式切换、规则表与试跑语义见 [route-design.md](./route-design.md) §2.11。节点语义与节点目录见 [route-design.md](./route-design.md) §4，图模型与执行模型见 [workflow-engine.md](./workflow-engine.md)，页面在控制台中的位置见 [desktop.md](./desktop.md)。画布与节点的实际实现以 `packages/console/source/pages/router/` 为准。

## 1. 设计目标

### 1.1 功能目标

1. 节点采用统一结构：节点外壳 + 业务内容 + 右侧配置面板。
2. 端口同时支持拖拽连线与点击插入节点。
3. 节点配置在画布右侧的固定面板里完成：非模态、可调宽，配置时画布保持可见。
4. 条件节点直接呈现 IF / ELIF / ELSE 的分支结构与独立出口。
5. 自定义边与连接线表达方向、状态与「可插入」入口。
6. 图数据、连接规则、路由校验与既有测试逻辑保持不变。

### 1.2 设计原则

1. 用「层级化组件」取代「单文件大组件」，每种节点独立成文件。
2. 交互范式参考 Dify 的节点编辑器，但视觉与文案保持 OSW 的稳定性。
3. 只搬展示层：业务数据一律由 props 注入，组件不持有图状态。
4. 组件结构以现有 `graph` 模型为准，不为了对齐参考实现而改动图模型。
5. 不引入 Dify 的 store、请求层、运行引擎与平台能力（插件、授权、协作 presence）。

## 2. 范围与边界

### 2.1 本文负责的范围

- 节点外壳、节点分区与节点操作栏；
- 端口交互（拖拽连线、点击插入）与节点选择器；
- 右侧配置面板的容器与布局；
- 自定义边与连接线；
- 条件分支的视觉表达；
- 画布与面板的布局协同。

### 2.2 明确不做

- 不复制 Dify 的 workflow store 与 DSL；
- 不做协作 presence、用户光标、评论与调试区；
- 不做插件安装、模板市场与授权中心；
- 不做迭代 / 循环容器的嵌套布局（迭代节点本身已实现，见 [route-design.md](./route-design.md) §4）；
- 不做 Dify 的历史版本共存与脚本操作。

## 3. 组件结构

### 3.1 分层

| 层 | 职责 | 位置 |
| --- | --- | --- |
| 页面层 | 画布与面板的布局协同、选中态、图操作入口 | `pages/router/page.tsx` |
| 注册层 | 节点/边类型表与「节点 kind → 配置面板」表 | `node-registry.ts`、`panel/index.ts` |
| 外壳层 | 节点统一外观：标题、描述、状态、端口、操作栏 | `components/workflow-node.tsx`、`node-sections.tsx`、`node-action-bar.tsx` |
| 节点层 | 每种节点的 body 内容 | `nodes/*.tsx` |
| 面板层 | 右侧面板容器与各节点表单 | `components/workflow-node-panel.tsx`、`panel/*.tsx` |
| 边层 | 边、连接线与方向渐变 | `components/workflow-edge.tsx`、`workflow-connection-line.tsx`、`edge-linear-gradient.tsx` |

### 3.2 文件结构

```text
packages/console/source/pages/router/
├── page.tsx                      # 画布与面板布局、选中态、图操作入口
├── node-registry.ts              # nodeTypes / edgeTypes
├── node-meta.ts / node-data.ts   # 节点元信息与面板数据契约
├── flow-projection.ts            # 图 ↔ 画布投影
├── graph-ops.ts                  # 加删节点、连线、删边
├── graph-versions.ts             # 图版本
├── field-hints.ts                # 路径字段候选与提示
├── components/
│   ├── workflow-node.tsx         # 统一节点外壳
│   ├── node-sections.tsx         # 标题 / 描述 / body 分区
│   ├── node-action-bar.tsx       # 节点操作栏
│   ├── node-handle.tsx           # 端口：拖拽连线 + 点击插入
│   ├── node-selector.tsx         # 插入节点的选择器
│   ├── workflow-node-panel.tsx   # 右侧面板容器（宽度约束与 resize）
│   ├── workflow-edge.tsx
│   ├── workflow-connection-line.tsx
│   ├── edge-linear-gradient.tsx
│   ├── block-icon.tsx / workflow-button.tsx
│   └── policy-menu.tsx / version-menu.tsx
├── nodes/                        # 十种节点，清单见 route-design.md §4
├── rules/                        # 规则表模式（见 route-design.md §2.11）：与画布不共用组件，也不共用字段候选（那张表从规则表自己的来源表拼），只共用条件判定的契约
└── panel/                        # 与节点一一对应的配置面板

packages/contracts/source/router/       # 图数据与执行，console 与 core 共用
├── types.ts / schemas.ts         # 节点、端口、边的类型与校验
├── engine.ts                     # 图执行
└── presets.ts                    # 策略预设（含内建默认策略）与空白脚手架图
```

### 3.3 组件职责

- `workflow-node.tsx`
  - 统一节点外壳；
  - 提供图标、标题行、描述、状态表现与 body 插槽；
  - 负责挂载公共端口与公共操作栏。
- `node-sections.tsx`
  - 提供节点标题 / 描述 / body 三个公共分区，保证十种节点外观同构。
- `condition-node.tsx`
  - 只负责 IF / ELIF / ELSE 的分支布局与摘要内容；
  - 不接管条件编辑。
- `workflow-node-panel.tsx`
  - 统一右侧配置容器；
  - 负责标题、关闭、内容区与宽度约束；
  - 业务内容由 `PANEL_COMPONENT_MAP` 按 kind 决定。
- `node-handle.tsx` / `node-selector.tsx`
  - 端口负责连线与「在此插入节点」入口；
  - 选择器只列可追加的节点类型。
- `note-node.tsx`
  - 备注便签：正文按 Markdown 只读渲染，是唯一一个带右下角缩放手柄的节点；
  - 尺寸写进 `model.size`，由页面放到 React Flow 的节点样式上（语义见 route-design.md §4.7）。
- `workflow-edge.tsx`
  - 自定义边的曲线、hover、状态与中间入口。

### 3.4 交互范式参考与许可

交互与视觉的范式参考 Dify 的节点编辑器（其 `app/components/workflow/`，内部使用 `reactflow@11`）。只借鉴结构与交互，不搬运资源：

- 不复制 Dify 的 LOGO、图标、文案与品牌资源；
- 不复制其 store、请求层与运行引擎；
- 差异只允许发生在依赖、数据源、文案与主题变量这四类适配点上。

Dify 采用修改版 Apache-2.0（附带多租户与前端 LOGO / 版权保留条件），因此上述边界同时是合规要求。

### 3.5 已知环境差异（适配约束）

| 差异点 | 参考实现 | OSW | 约束 |
| --- | --- | --- | --- |
| 图库 | `reactflow@11` | `@xyflow/react@12` | import 统一走 `@xyflow/react`；按 v12 调整 `NodeProps` / `EdgeProps` / `useStore` / `Handle` |
| UI 基础组件 | `@langgenius/dify-ui/*` | `components/ui/*`（shadcn 风格） | 建立映射；缺失组件写最小实现，不新增依赖 |
| 样式体系 | Tailwind + workflow 语义变量 | Tailwind v4 + 主题变量 | 变量名按 OSW 主题重映射，保留层级关系 |
| 状态管理 | zustand 全量 workflow store | 页面 state + 图模型 | 用 props / 局部 state 注入，不引入外部 store |
| 节点类型 | `BlockEnum` | `WorkflowNodeKind` 十种 | 只保留映射到本项目的分支 |
| 文案 | `react-i18next` + `t()` | 组件内中文常量 | 去掉 `t()` |
| 工具库 | `es-toolkit`、`ahooks`、`jotai` | 现有依赖 | 用原生实现或现有依赖替代 |

## 4. 交互设计

### 4.1 节点外壳与状态

- 所有节点共用一个外壳：`node-registry.ts` 里十种 key 全部指向 `WorkflowNode`，内部按 `model.kind` 渲染各自 body。
- 外壳负责图标 + 标题行、描述、状态表现、body 插槽、公共端口与操作栏。
- 选中 / 运行中 / 成功 / 失败只改变边框与色条，不改变节点的尺寸与布局。
- 节点本身是只读视图：编辑一律在右侧面板完成，节点上不放表单控件。

### 4.2 端口：拖拽连线 + 点击插入

- 端口可见样式为短竖线，命中区大于可见区。
- 拖拽端口走 React Flow 原生连接，落到 `graph-ops` 的加边逻辑。
- source 端口可点击打开节点选择器；选定后自动补齐「上游 → 新节点 → 下游」的边与端口。
- 只有 source 端口支持插入；target 端口只接受连线。
- 节点选择器只列可追加的节点类型（`AppendableKind`），支持按名称过滤。

### 4.3 右侧配置面板

- 非模态固定在画布右侧，画布保持可见、可拖拽。
- 宽度默认 420、最小 380；展开时至少为画布保留 380（`computeMaxPanelWidth`）。
- 宽度可拖拽调整，上限随画布宽度变化；窗口缩小导致超出上限时，宽度被夹回上限。
- 面板内容由 `PANEL_COMPONENT_MAP` 按节点 kind 决定，节点选中态与面板一一对应。
- 面板内表单沿用现有业务表单组件，不换控件库。

### 4.4 条件分支

- 条件节点把分支逐行画出：`IF` / `ELIF`（多分支时带 `CASE n` 标记）行 + 固定 `ELSE` 行，每行带自己的出口端口。
- 行内展示条件条目（变量 / 操作符 / 值），多条件之间插入 AND / OR 标记；完整条件编辑在面板里完成。
- 尚未配置分支时，节点直接提示「尚未配置分支，所有请求都会走 ELSE」。
- 端口与分支行对齐；分支数量变化时节点高度随内容增长。

### 4.5 边与连接线

- 边使用贝塞尔曲线并带方向渐变，渐变色随两端运行状态变化；只有上游已结束、下游已开始时才画渐变。
- hover 时出现可插入的中间入口；边中间插入与端口插入走同一条加节点逻辑。
- 拖拽中的连接线使用独立组件，与已连成的边在视觉上区分。
- 边的选中态与节点选中态互不干扰，事件传播彼此隔离。

### 4.6 备注便签

- 便签是唯一「尺寸不等于内容」的节点：卡片右下角有一个缩放手柄（选中或 hover 时出现），拖它改尺寸。
- 拖拽位移按当前缩放换算成画布单位（除以 `flow.getZoom()`），结果夹在最小 / 最大尺寸之间并取整，避免缩放后半像素把文字拖糊。
- 尺寸存进节点的 `size` 随图保存；右侧面板只报当前尺寸并提供「恢复默认尺寸」，不在面板里做第二套缩放交互。
- 便签没有端口，因此不参与连线与插入交互；正文很长时滚轮滚的是正文（`nowheel`）而不是缩放画布。

## 5. 设计约束

- **图数据稳定**：`sourcePort` / `targetPort` 与图 schema 不变，旧图必须能继续渲染；兼容处理只放在 UI 层。
- **事件隔离**：端口点击插入、端口拖拽连线、节点点击选中、画布空白点击必须互不误触发。
- **视觉下限**：不使用阴影；层级用背景明度阶梯表达；模块容器用边框圈定；字号下限 11px。
- **边界**：组件不得引入 Dify 的 store / 请求 / 运行引擎，业务数据一律由 props 注入。
