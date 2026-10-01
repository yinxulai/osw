import { isBuiltInDefaultLogicalModel } from '@common/schemas'

import {
  ALL_WORKFLOW_PROTOCOLS,
  DEFAULT_OPERATOR_SET,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  PROMPT_TIMEOUT_DEFAULT,
  SCRIPT_TIMEOUT_DEFAULT,
  type AppendableKind,
  type ConditionCase,
  type ConditionOperator,
  type ConditionRule,
  type ControlInputItem,
  type ControlInputKind,
  type NodePosition,
  type NoteNode,
  type RuntimeLogicalModel,
  type SchemaValueType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeModel,
} from './types'

/**
 * 路由图的纯构造器：四个策略预设（第一个即内建默认策略）、空白脚手架图，以及改图时用到的小工厂。
 *
 * 这里没有任何渲染层依赖（React / React Flow / 图标库），因为**服务端也要用它**：
 * 代理遇到「还没有人保存过路由图」时用它生成一份内建默认策略直接跑，
 * 于是「开箱可用」与「用户保存的图」走的是同一条执行路径，而不是两条各自漂移的规则。
 *
 * 画布侧的 React Flow 投影（节点排布、连线构建、连线着色）留在渲染进程的
 * `pages/router/flow-projection.ts`。
 */

/**
 * 测试运行用的示例原始输入：一份**真实的 OpenAI Chat Completions 请求**。
 *
 * 它只负责给「测试输入」框一个能直接跑的默认值，**不是**字段候选表的来源：
 * 体里有什么字段、叫什么名字，是协议层的事（见 `@common/router/request-shape`），
 * 所以这里写得像真实请求就行，不必（也不能）迁就图上某个节点想看到什么。
 * `logicalModels` 由页面在运行时注入真实模型列表。
 * `user-agent` 是给「UA 分流」预设用的，`messages` / `tools` 是给「脚本分流」预设用的
 * （它读的是「协议发现」节点声明的字段）：不预置这些，对应预设跑起来就只能走兜底分支。
 */
export const samplePayload = {
  request: {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider': 'openai',
      'user-agent': 'Cursor/0.42.3 (darwin arm64)',
    },
    body: {
      model: 'gpt-4o-mini',
      tenant: 'vip-cn',
      messages: [{ role: 'user', content: '帮我把这个模块重构成 TypeScript。' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: '读取文件内容' } }],
    },
  },
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

/**
 * 新建条件规则的默认值。
 *
 * 默认字段只能取**输入节点真的保证得了**的东西（请求行）—— 请求体里的字段
 * 是协议层的事，输入节点不知道体里有什么，拿一个体字段当默认值是错的：
 * 一建出来就是「字段缺失」告警，还会误导用户以为入口节点看得见请求体内容。
 */
export function createConditionRule(): ConditionRule {
  return {
    fieldPath: 'request.method',
    valueType: 'string',
    operator: 'equals',
    valueSource: 'literal',
    valueFieldPath: '',
    value: 'POST',
  }
}

export function createConditionCase(id: string = createId('case')): ConditionCase {
  return {
    id,
    name: '分支 1',
    logicalOperator: 'and',
    conditions: [createConditionRule()],
  }
}

/** 某个字段类型可用的操作符集合；条件面板按字段类型列操作符时用它。 */
export function getOperatorsByType(type: SchemaValueType): ConditionOperator[] {
  return DEFAULT_OPERATOR_SET[type]
}

export function createControlItem(kind: ControlInputKind): ControlInputItem {
  if (kind === 'switch') {
    return {
      id: createId('control'),
      key: 'featureEnabled',
      label: '功能开关',
      kind,
      enabled: true,
      defaultValue: true,
    }
  }

  return {
    id: createId('control'),
    key: 'routeMode',
    label: '路由模式',
    kind,
    enabled: true,
    defaultValue: 'balanced',
    options: [
      { label: 'Balanced', value: 'balanced' },
      { label: 'Fast', value: 'fast' },
      { label: 'Strict', value: 'strict' },
    ],
  }
}

export function createNodeByKind(kind: AppendableKind, position: NodePosition): WorkflowNodeModel {
  const id = createId(kind)

  if (kind === 'control-input') {
    return {
      id,
      kind,
      name: '控制输入节点',
      enabled: true,
      description: '注入开关与下拉等系统控制值。',
      position,
      controls: [createControlItem('switch')],
    }
  }

  if (kind === 'protocol-discovery') {
    return {
      id,
      kind,
      name: '协议发现节点',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position,
    }
  }

  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '按类型感知条件做 IF / ELSE 多分支。',
      position,
      cases: [createConditionCase()],
    }
  }

  if (kind === 'iteration') {
    return {
      id,
      kind,
      name: '遍历迭代节点',
      enabled: true,
      description: '遍历数组 / 对象，逐项执行循环体并汇总结果。',
      position,
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
    }
  }

  if (kind === 'script') {
    return {
      id,
      kind,
      name: 'JS 脚本节点',
      enabled: true,
      description: '在沙箱里跑一段 JS，把结果写回运行数据。',
      position,
      code: '// payload 是本次运行数据的深拷贝，get(路径) 支持 a[*].b 通配投影\nreturn get(\'logicalModels[*].modelId\') || []',
      resultPath: 'route.scriptResult',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    }
  }

  if (kind === 'prompt') {
    return {
      id,
      kind,
      name: 'LLM 节点',
      enabled: true,
      description: '用指定逻辑模型执行提示词，回复写回运行数据。',
      position,
      logicalModelId: '',
      systemPrompt: '',
      promptTemplate: '请从 ${logicalModels[*].modelId} 里挑一个最适合当前请求的逻辑模型，只回答 id。',
      resultPath: 'route.promptResult',
      temperature: 0.7,
      maxTokens: 1_024,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    }
  }

  if (kind === 'note') {
    return createNoteNode(position)
  }

  return {
    id,
    kind: 'model-select',
    name: '逻辑模型选择节点',
    enabled: true,
    description: '选择一个或多个逻辑模型，交由出口执行。',
    position,
    source: 'fixed',
    variablePath: '',
    modelIds: [],
    fallbackModelIds: [],
  }
}

const fixedNodeCopy = {
  input: {
    name: '输入请求',
    description: '固定入口节点：接收原始请求并开始路由。',
  },
  output: {
    name: '路由结果出口',
    description: '固定出口节点：输出路由结果并交由代理执行。',
  },
} as const

export function withFixedNodeCopy(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  let changed = false
  const next = nodes.map(node => {
    if (node.kind !== 'input' && node.kind !== 'output') return node
    const fixed = node.kind === 'input' ? fixedNodeCopy.input : fixedNodeCopy.output
    if (node.name === fixed.name && node.description === fixed.description) return node
    changed = true
    return { ...node, name: fixed.name, description: fixed.description }
  })
  return changed ? next : nodes
}

/* ------------------------------------------------------------------------- *
 * 策略预设
 * ------------------------------------------------------------------------- */

/**
 * 预设自带的用法备注：位置与尺寸固定，四张图上的便签长得一样。
 *
 * 落点放在输入节点的**左上方**（而不是右下方）是算过的：画布首屏会 `fitView` 整张图，
 * 而这几张预设的包围盒都是「宽」撑住缩放比例的，往上方扩展不会改变首屏缩放，
 * 往右 / 往下加才会把小图硬生生缩一半。
 */
function createPresetNoteNode(name: string, text: string): NoteNode {
  return {
    ...createNoteNode({ x: 80, y: -240 }),
    // id 必须固定：预设图的「同一张图」判定是逐字节比 JSON（`isSameGraph`），
    // 用随机 id 的话每次生成都不一样，「当前套的是哪个预设」永远匹配不上。
    id: 'note-usage',
    name,
    text,
    size: { width: 440, height: 220 },
  }
}

/** 默认策略的用法说明（落在预设图上，属于用户数据，不参与界面本地化）。 */
const DEFAULT_POLICY_NOTE = `## 默认策略：请求模型直连

请求里写的模型名**命中逻辑模型**就直连它，否则落到默认逻辑模型。

**链路**
1. 输入请求
2. 协议发现：先认出协议，再按协议解析请求体（模型名写在哪，由协议决定）
3. 条件：请求模型是否在逻辑模型列表里
4. 命中 → 直连请求模型；未命中 → 默认逻辑模型

**常见改法**
- 给某个客户端单独分流：在协议发现后面接一个条件节点
- 想固定落点：把「直连请求模型」的来源改成「固定」`

/** UA 分流预设的用法说明。 */
const USER_AGENT_NOTE = `## UA 分流：按客户端来源分流

逐个看请求头，头值里出现客户端标识就落到对应逻辑模型；整轮都认不出来就回落默认。

**链路**
1. 遍历迭代：遍历请求头的每一个头值
2. 条件：头值包含 Cursor / claude-cli
3. 命中 → 对应落点；整轮都未命中 → 兜底逻辑模型

**三条咬合的约定**
- 循环体末尾把落点写进 route.modelIds，迭代节点读同一个字段判定「本轮命中」
- 迭代节点的「汇总结果写回路径」留空：整轮未命中时不能用空数组盖掉循环体写下的值
- 兜底放在下游一个「变量取值」的落点节点里，它同时覆盖命中沿用与未命中兜底`

/** LLM 复杂度预设的用法说明。 */
const LLM_COMPLEXITY_NOTE = `## LLM 复杂度分流

先让逻辑模型读一遍请求，判定 simple / complex，再按结论落到不同逻辑模型。

**链路**
1. LLM 节点：把请求体整体交给判定模型，回复写进 route.complexity
2. 条件：route.complexity 匹配正则 [Cc]omplex
3. 复杂 → 复杂落点；其余 → 简单落点

**注意**
- 用正则而不是等于：LLM 回复里的多余空白、首字母大小写都能容忍
- 想更确定：把提示词改成「只回答 JSON」，再用脚本节点解析它
- 判定默认借用默认逻辑模型，换成专门的小模型更省
- 这条策略没接协议发现节点：它读的是请求体整体，不需要知道体里的字段名`

/** 脚本分流预设的用法说明。 */
const SCRIPT_ROUTING_NOTE = `## JS 脚本分流

用一段沙箱脚本把请求规模算成分档，再按分档落到不同逻辑模型。

**链路**
1. 协议发现：声明消息列表 / 工具列表在请求体里的位置
2. JS 脚本：按消息数、上下文字数、工具数打分，返回 simple 或 complex
3. 条件：route.complexity 等于 complex
4. 复杂 → 复杂落点；其余 → 简单落点

**注意**
- 脚本先看 route.protocol，再决定消息列表读 messages 还是 input
- console.log 会进测试运行的「控制台」，打分过程可以直接核对
- 阈值（6 条消息 / 8000 字 / 带工具）按自己的业务调`

/** 固定入口节点（input / output）的名称与描述不可修改。 */
export function createInputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'input',
    kind: 'input',
    name: fixedNodeCopy.input.name,
    enabled: true,
    description: fixedNodeCopy.input.description,
    position,
  }
}

/** 固定出口节点（不受保护的固定节点使用同一份文案）。 */
export function createOutputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'output',
    kind: 'output',
    name: fixedNodeCopy.output.name,
    enabled: true,
    description: fixedNodeCopy.output.description,
    position,
    includeTrace: true,
    summaryLevel: 'detailed',
  }
}

/**
 * 从选择器新拖出来的便签先给一段自述，用户直接覆盖着写就行。
 *
 * 内容是**用户数据**（会随图落进数据库），所以不参与界面本地化，
 * 和预设里的节点名 / 描述是同一条规则。
 */
export const NOTE_NODE_DEFAULT_TEXT = `## 备注

在这里写这张图的说明，支持 Markdown。

- 备注**不参与执行**：引擎遇到它会直接跳过，不影响路由结果
- 拖右下角可以改尺寸，标题就是上面这行名字
- 写清楚：这张图什么时候用、落点为什么这么选`

/** 备注（便签）节点：只写在画布上，不参与引擎执行。 */
export function createNoteNode(position: NodePosition, text: string = NOTE_NODE_DEFAULT_TEXT): NoteNode {
  return {
    id: createId('note'),
    kind: 'note',
    name: '备注',
    enabled: true,
    description: '画布上的说明便签：写给人看，不参与路由执行。',
    position,
    text,
    size: { width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT },
  }
}

/** 预设生成时的落点来源：预设里每个落点都必须是真实存在的逻辑模型 id。 */
export interface PresetModelPool {
  /** 兜底落点 id；一个已启用逻辑模型都没有时为 `null`。 */
  fallbackModelId: string | null
  /** 可用于分流落点的 id，按当前顺序排列，已排除兜底落点。 */
  landingModelIds: string[]
}

/**
 * 从当前可见的逻辑模型里挑出预设的落点。
 *
 * 预设的意义是「选完就能跑」：写一个不存在的 id，运行结果只会报「没有可用逻辑模型」，
 * 用户还得先去猜该填什么。所以落点一律在生成时按现有逻辑模型定好——
 * 兜底落点取内建默认逻辑模型，分流落点按顺序取兜底之外的其他逻辑模型。
 *
 * 内建默认逻辑模型被停用/删掉时退回第一个已启用模型：
 * 这一条比运行时的落地规则（落点全不可用时直接回 503）宽松，是故意的——
 * 生成预设是「帮你先把图填上」，前面已经有一个可视可选的真逻辑模型，就没必要留个空落点；
 * 而运行时遇到同样情况则宁可拒绝，也不能替用户猜一个上游。
 */
export function createPresetModelPool(models: RuntimeLogicalModel[]): PresetModelPool {
  const enabledModels = models.filter(model => model.enabled)
  const fallbackModel = enabledModels.find(isBuiltInDefaultLogicalModel) ?? enabledModels[0]
  return {
    fallbackModelId: fallbackModel?.modelId ?? null,
    landingModelIds: enabledModels.filter(model => model.modelId !== fallbackModel?.modelId).map(model => model.modelId),
  }
}

/**
 * 取落点逻辑模型：`index` 为 `null` 时取兜底落点，否则取第 `index` 个分流落点。
 *
 * 分流候选不够时退回兜底落点——宁可几条分支落到同一个逻辑模型，也不要留下一个死落点；
 * 连兜底都没有（一个已启用逻辑模型都没有）时返回空数组，出口节点会照实报「没有可用逻辑模型」。
 */
export function resolveLandingModelIds(pool: PresetModelPool, index: number | null): string[] {
  const landingModelId = index === null ? pool.fallbackModelId : pool.landingModelIds[index] ?? pool.fallbackModelId
  return landingModelId ? [landingModelId] : []
}

/**
 * 默认策略：请求模型命中逻辑模型 id 就直连它，否则落到默认逻辑模型。
 *
 * 规则全部由基础节点组合而成，没有任何专用节点，
 * 命中判断就是一条普通的「字段 in 字段」条件：
 * 输入 → 协议发现 → 条件（request.body.model in logicalModels[*].modelId）
 *          ├─ IF   → 逻辑模型选择（变量取值 request.body.model）→ 出口
 *          └─ ELSE → 逻辑模型选择（兜底落点，生成时定好具体 id）→ 出口
 *
 * 为什么中间要过一道协议发现：请求模型是**协议层**的事实。入口节点不解析请求体，
 * 它不知道体里有什么、更不知道模型名写在哪（`/v1/responses` 在 `input` 旁边，
 * 其余协议在 `messages` 旁边）。要入口节点报出 `request.body.model`，
 * 就等于要求它兼容所有协议。所以这一步交给协议发现节点：
 * 它按命中的协议声明请求体形状，下游条件读到的就是协议解析后的位置。
 * 四条协议分支都接同一个条件（包括 `unknown`）—— 认不出协议也要按同一套策略兜底。
 *
 * 左侧直接读请求里写的模型名，不在 `route` 下另存一份副本：
 * 派生副本会多出第二个事实源，副本与请求不同步时没人说得清哪个是真的。
 * 比较右侧用的是通配投影 `logicalModels[*].modelId`：
 * 上下文里本来就带着完整的逻辑模型列表，没必要再派生一份 id 数组。
 *
 * 兜底落点在生成时从传入的逻辑模型里挑真实 id，所以这条策略套用即可运行，
 * 不会因为写死了一个不存在的 id 而一上手就报「没有可用逻辑模型」。
 */
export function createDefaultPolicyGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const conditionCase: ConditionCase = {
    ...createConditionCase('case-1'),
    name: '请求模型在逻辑模型列表里',
    conditions: [
      {
        fieldPath: 'request.body.model',
        valueType: 'string',
        operator: 'in',
        valueSource: 'field',
        valueFieldPath: 'logicalModels[*].modelId',
      },
    ],
  }

  return {
    version: 1,
    nodes: [
      createPresetNoteNode('默认策略怎么用', DEFAULT_POLICY_NOTE),
      createInputNode({ x: 80, y: 220 }),
      {
        id: 'protocol',
        kind: 'protocol-discovery',
        name: '协议发现',
        enabled: true,
        description: '先认出协议，再按该协议声明请求体形状；下游读的是协议解析后的字段。',
        position: { x: 420, y: 220 },
      },
      {
        id: 'condition',
        kind: 'condition',
        name: '请求模型是否命中逻辑模型',
        enabled: true,
        description: 'request.body.model 在 logicalModels[*].modelId 里时走直连分支，否则落到默认逻辑模型。',
        position: { x: 760, y: 220 },
        cases: [conditionCase],
      },
      {
        id: 'model-direct',
        kind: 'model-select',
        name: '直连请求模型',
        enabled: true,
        description: '把 request.body.model 的取值直接当作逻辑模型 id。',
        position: { x: 1100, y: 110 },
        source: 'variable',
        variablePath: 'request.body.model',
        modelIds: [],
        fallbackModelIds: [],
      },
      {
        id: 'model-default',
        kind: 'model-select',
        name: '默认逻辑模型',
        enabled: true,
        description: '未命中时落到内置的默认逻辑模型。',
        position: { x: 1100, y: 330 },
        source: 'fixed',
        variablePath: '',
        modelIds: resolveLandingModelIds(pool, null),
        fallbackModelIds: [],
      },
      createOutputNode({ x: 1440, y: 220 }),
    ],
    edges: [
      { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
      ...ALL_WORKFLOW_PROTOCOLS.map(protocol => ({
        id: `edge-protocol-${protocol}`,
        sourceNodeId: 'protocol',
        sourcePort: protocol,
        targetNodeId: 'condition',
      })),
      { id: 'edge-condition-direct', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model-direct' },
      { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model-default' },
      { id: 'edge-model-direct-output', sourceNodeId: 'model-direct', sourcePort: 'out', targetNodeId: 'output' },
      { id: 'edge-model-default-output', sourceNodeId: 'model-default', sourcePort: 'out', targetNodeId: 'output' },
    ],
  }
}

/**
 * 空白图：一张只有基础骨架、不含任何策略的图。
 *
 * 它**不是**内建默认策略，也不是任何界面上的起始状态 —— 一版图都没保存过时，
 * 画布与代理拿到的都是 `ROUTER_POLICY_PRESETS` 里 `isDefault` 的那一个（`createDefaultPolicyGraph`）。
 * 留在这里是因为图编辑用例需要一个「节点种类齐、连线少」的脚手架：改一条边能一眼看出结果。
 */
export function createBlankGraph(): WorkflowGraph {
  // 分支 id 固定，保证同一预设每次生成的图完全一致（否则「当前策略」永远匹配不上）。
  const conditionCase = createConditionCase('case-1')
  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 220 }),
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position: { x: 420, y: 220 },
    },
    {
      id: 'condition',
      kind: 'condition',
      name: '条件分支',
      enabled: true,
      description: '按类型感知条件执行 IF / ELSE 多分支。',
      position: { x: 760, y: 220 },
      cases: [conditionCase],
    },
    {
      id: 'model',
      kind: 'model-select',
      name: '逻辑模型选择',
      enabled: true,
      description: '选择一个或多个逻辑模型，交由出口执行。',
      position: { x: 1100, y: 220 },
      source: 'fixed',
      variablePath: '',
      modelIds: [],
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1440, y: 220 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    { id: 'edge-protocol-completions', sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' },
    { id: 'edge-protocol-responses', sourceNodeId: 'protocol', sourcePort: 'openai-responses', targetNodeId: 'condition' },
    { id: 'edge-protocol-anthropic', sourceNodeId: 'protocol', sourcePort: 'anthropic-messages', targetNodeId: 'condition' },
    { id: 'edge-protocol-unknown', sourceNodeId: 'protocol', sourcePort: 'unknown', targetNodeId: 'model' },
    { id: 'edge-condition-case', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model' },
    { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model' },
    { id: 'edge-model-output', sourceNodeId: 'model', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/** 内置策略预设的标识符集合。展示文案不在这里，而在渲染层的 `pages/router/policy-preset-text.ts`。 */
export type RouterPolicyPresetId = 'model-direct' | 'ua-source-routing' | 'llm-complexity-routing' | 'script-routing'

export interface RouterPolicyPreset {
  id: RouterPolicyPresetId
  /** 是否是系统内建的默认策略（列表第一项，可在任何时刻一键选回）。 */
  isDefault: boolean
  /** 生成预设图；落点逻辑模型由传入的当前逻辑模型列表定好，保证套用后即可运行。 */
  createGraph: (models: RuntimeLogicalModel[]) => WorkflowGraph
}

/**
 * UA 分流模板：按客户端来源分流到不同逻辑模型，其余来源回落默认。
 *
 * 「来源」不依赖具体头名：遍历 `request.headers` 逐个看头值，
 * 值里出现哪个客户端标识就走哪个分支 —— 头名大小写、由哪个头携带都不影响判定，
 * 这正是遍历迭代相对「直接取 `request.headers.user-agent`」的价值所在。
 *
 * 两个分支的落点在生成时按传入的逻辑模型列表定好：优先取兜底之外的其他逻辑模型，
 * 所以套用后直接能跑；想按自己的意图分流，把落点改成目标逻辑模型即可。
 *
 * 循环与命中判定靠三条约定咬合：
 * - 循环体末端把落点写进 `route.modelIds`，迭代节点读同一个 `collectPath` 判定本轮命中；
 * - `resultPath` 留空：整轮都没命中时，汇总结果不能用空数组把循环体已写下的值盖掉；
 * - 兜底放在下游一个变量取值的逻辑模型选择节点里，它同时覆盖「命中沿用」与「未命中兜底」。
 */
export function createUserAgentGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const cursorLanding = resolveLandingModelIds(pool, 0)
  const claudeCliLanding = resolveLandingModelIds(pool, 1)
  const fallbackLanding = resolveLandingModelIds(pool, null)
  const cursorCase: ConditionCase = {
    id: 'case-cursor',
    name: 'Cursor 客户端',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.iteration.item',
        valueType: 'string',
        operator: 'contains',
        valueSource: 'literal',
        value: 'Cursor',
      },
    ],
  }

  const claudeCliCase: ConditionCase = {
    id: 'case-claude-cli',
    name: 'Claude CLI 客户端',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.iteration.item',
        valueType: 'string',
        operator: 'contains',
        valueSource: 'literal',
        value: 'claude-cli',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createPresetNoteNode('UA 分流怎么用', USER_AGENT_NOTE),
    createInputNode({ x: 80, y: 340 }),
    {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历请求头识别来源',
      enabled: true,
      description: '逐个遍历 request.headers 的头值，命中客户端标识时把落点逻辑模型收进 route.modelIds。',
      position: { x: 460, y: 340 },
      sourcePath: 'request.headers',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: '',
      maxIterations: 20,
    },
    {
      id: 'ua-condition',
      kind: 'condition',
      name: '头值里的客户端标识',
      enabled: true,
      description: '按头值里出现的客户端标识分流：Cursor / Claude CLI，其余头继续下一轮。',
      position: { x: 880, y: 200 },
      cases: [cursorCase, claudeCliCase],
    },
    {
      id: 'model-cursor',
      kind: 'model-select',
      name: 'Cursor 落点',
      enabled: true,
      description: 'Cursor 客户端落到这个逻辑模型。',
      position: { x: 1280, y: 40 },
      source: 'fixed',
      variablePath: '',
      modelIds: cursorLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-claude-cli',
      kind: 'model-select',
      name: 'Claude CLI 落点',
      enabled: true,
      description: 'Claude CLI 客户端落到这个逻辑模型。',
      position: { x: 1280, y: 300 },
      source: 'fixed',
      variablePath: '',
      modelIds: claudeCliLanding,
      fallbackModelIds: [],
    },
    {
      id: 'fallback-model',
      kind: 'model-select',
      name: '落点：命中即用，否则兜底',
      enabled: true,
      description: '识别出客户端时沿用迭代收到的落点；整轮都没识别出来才回落到兜底逻辑模型。',
      position: { x: 1280, y: 560 },
      source: 'variable',
      variablePath: 'route.modelIds',
      modelIds: [],
      fallbackModelIds: fallbackLanding,
    },
    createOutputNode({ x: 1680, y: 340 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-iteration', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-body', sourceNodeId: 'iteration', sourcePort: 'body', targetNodeId: 'ua-condition' },
    { id: 'edge-ua-cursor', sourceNodeId: 'ua-condition', sourcePort: cursorCase.id, targetNodeId: 'model-cursor' },
    { id: 'edge-ua-claude-cli', sourceNodeId: 'ua-condition', sourcePort: claudeCliCase.id, targetNodeId: 'model-claude-cli' },
    // 没识别出客户端也要回到迭代节点：这一条边代表「本轮结束」，不是死循环。
    { id: 'edge-ua-miss-back', sourceNodeId: 'ua-condition', sourcePort: 'else', targetNodeId: 'iteration' },
    { id: 'edge-cursor-back', sourceNodeId: 'model-cursor', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-claude-cli-back', sourceNodeId: 'model-claude-cli', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-fallback', sourceNodeId: 'iteration', sourcePort: 'out', targetNodeId: 'fallback-model' },
    { id: 'edge-fallback-output', sourceNodeId: 'fallback-model', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/**
 * LLM 复杂度分流模板：让逻辑模型读一遍请求，按复杂度落到不同逻辑模型。
 *
 * 输入 → LLM 节点（判断复杂度，回复写进 route.complexity）
 *        → 条件（route.complexity 匹配正则 [Cc]omplex）
 *          ├─ 复杂 → 逻辑模型选择（固定复杂落点）→ 出口
 *          └─ 其余 → 逻辑模型选择（固定简单落点）→ 出口
 *
 * 判定用「匹配正则」而不是「等于」：LLM 的回复是自由文本，正则不锚定首尾，
 * 天然容忍多余空白，`[Cc]` 又顺手兼容了首字母大写。
 * 想让判定绝对可靠，就把提示词改成「只回答 JSON」，再用脚本节点解析它。
 *
 * 提示词拼的是**请求体整体**（`${request.body}`）：那是入口节点保证得了的东西（协议无关），
 * 所以这条策略不需要协议发现节点。要精确到「消息列表」，就在前面加一个协议发现节点、
 * 把模板改成 `${request.body.messages}` —— 这里刻意不替用户猜协议：
 * `/v1/responses` 的消息在 `input` 里而不在 `messages` 里，猜错就是静默判定成「简单」。
 *
 * LLM 节点默认借用兜底逻辑模型（生成时定好），换成专门的判定用小模型更省；
 * 两个落点也在生成时按传入的逻辑模型列表定好，套用后直接能跑。
 */
export function createLlmComplexityGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const complexLanding = resolveLandingModelIds(pool, 0)
  const simpleLanding = resolveLandingModelIds(pool, 1)
  const complexCase: ConditionCase = {
    id: 'case-complex',
    name: '复杂请求',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.complexity',
        valueType: 'string',
        operator: 'regex',
        valueSource: 'literal',
        value: '[Cc]omplex',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createPresetNoteNode('LLM 复杂度分流怎么用', LLM_COMPLEXITY_NOTE),
    createInputNode({ x: 80, y: 300 }),
    {
      id: 'complexity-prompt',
      kind: 'prompt',
      name: 'LLM 判断请求复杂度',
      enabled: true,
      description: '把请求交给逻辑模型读一遍，只让它回一个词：simple 或 complex。',
      position: { x: 460, y: 300 },
      logicalModelId: pool.fallbackModelId ?? '',
      systemPrompt: '你是模型路由助手：只判断请求复杂度，不回答请求内容，也不做任何解释。',
      promptTemplate: '判断下面这次请求的复杂度，只回答一个词：simple 或 complex。\n\n请求：${request.body}',
      resultPath: 'route.complexity',
      temperature: 0.2,
      maxTokens: 32,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    },
    {
      id: 'complexity-condition',
      kind: 'condition',
      name: '复杂度判定',
      enabled: true,
      description: 'route.complexity 命中 [Cc]omplex 视为复杂请求；LLM 失败或回答认不出来时走「其余」。',
      position: { x: 880, y: 300 },
      cases: [complexCase],
    },
    {
      id: 'model-complex',
      kind: 'model-select',
      name: '复杂请求落点',
      enabled: true,
      description: '复杂请求落到这个逻辑模型。',
      position: { x: 1300, y: 140 },
      source: 'fixed',
      variablePath: '',
      modelIds: complexLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-simple',
      kind: 'model-select',
      name: '其余请求落点',
      enabled: true,
      description: '简单请求落到这个逻辑模型。',
      position: { x: 1300, y: 460 },
      source: 'fixed',
      variablePath: '',
      modelIds: simpleLanding,
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1720, y: 300 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-prompt', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'complexity-prompt' },
    { id: 'edge-prompt-condition', sourceNodeId: 'complexity-prompt', sourcePort: 'out', targetNodeId: 'complexity-condition' },
    { id: 'edge-condition-complex', sourceNodeId: 'complexity-condition', sourcePort: complexCase.id, targetNodeId: 'model-complex' },
    { id: 'edge-condition-simple', sourceNodeId: 'complexity-condition', sourcePort: 'else', targetNodeId: 'model-simple' },
    { id: 'edge-complex-output', sourceNodeId: 'model-complex', sourcePort: 'out', targetNodeId: 'output' },
    { id: 'edge-simple-output', sourceNodeId: 'model-simple', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/**
 * JS 脚本分流模板：用一段沙箱脚本把请求规模算成分档，再按分档落到不同逻辑模型。
 *
 * 输入 → 协议发现 → JS 脚本节点（算消息数 / 上下文字数 / 工具数，返回 simple 或 complex）
 *        → 条件（route.complexity 等于 complex）
 *          ├─ 复杂 → 逻辑模型选择（固定复杂落点）→ 出口
 *          └─ 其余 → 逻辑模型选择（固定简单落点）→ 出口
 *
 * 中间那道协议发现是必须的：脚本读的是**请求体里的具体字段**（消息列表、工具数），
 * 那是协议层的事实。入口节点不解析请求体，它只保证 `request.body` 整体存在；
 * 要拿到 `request.body.messages`，得让协议发现节点按命中的协议声明下来 ——
 * 少了这道节点，脚本编辑器里就补全不出这个路径，图能跑但改不动。
 * 认出协议的同时它也把协议名写进 `route.protocol`，脚本照着这个一手事实决定
 * 消息列表读 `messages` 还是 `input`：体里同时有这两者时，只有协议说得清哪个是真的。
 * 协议分支（四种，含 `unknown`）全部接同一个脚本：认不出协议也要按同一套策略兜底。
 *
 * 与 LLM 模板的分流骨架完全一致，差别只在「谁来判定」：
 * 脚本的返回值是确定的字符串，所以这里用「等于」精确判定，不需要正则去容错。
 * `console.log` 会进 trace 的「控制台」，打分过程可以在测试运行面板里直接核对。
 */
export function createScriptRoutingGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const complexLanding = resolveLandingModelIds(pool, 0)
  const simpleLanding = resolveLandingModelIds(pool, 1)
  const complexCase: ConditionCase = {
    id: 'case-complex',
    name: '复杂请求',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.complexity',
        valueType: 'string',
        operator: 'equals',
        valueSource: 'literal',
        value: 'complex',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createPresetNoteNode('脚本分流怎么用', SCRIPT_ROUTING_NOTE),
    createInputNode({ x: 80, y: 300 }),
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '按路径与请求头认出协议，声明脚本要读的请求体字段（消息列表、工具列表）。',
      position: { x: 340, y: 300 },
    },
    {
      id: 'complexity-script',
      kind: 'script',
      name: 'JS 计算请求复杂度',
      enabled: true,
      description: '按消息数 / 上下文字数 / 工具数打分，返回 simple 或 complex 写进 route.complexity。',
      position: { x: 600, y: 300 },
      code: `// payload 是本次运行数据的深拷贝；get(路径) 支持 a[*].b 通配投影。
// 消息列表写在哪是协议层的事实：completions / anthropic 在 messages 里，responses 在 input 里。
// 上游「协议发现」节点已经把认出的协议写进 route.protocol，照着它取**那一条**路径 ——
// 「先取 messages、取不到再取 input」这种兜底顺序在体里两者都有时会读错那一个。
const messages = get(get('route.protocol') === 'openai-responses' ? 'request.body.input' : 'request.body.messages')
const tools = get('request.body.tools')
const messageCount = Array.isArray(messages) ? messages.length : 0
const toolCount = Array.isArray(tools) ? tools.length : 0
// 认不出协议（route.protocol 是 unknown）时上面两个都取不到，退化成整个请求体的长度，至少还有个量级。
const charCount = JSON.stringify(messages ?? get('request.body') ?? '').length

// 三条里任意一条成立就算复杂请求，阈值按自己的业务调。
const isComplex = toolCount > 0 || messageCount > 6 || charCount > 8_000
console.log('复杂度判定', { messageCount, toolCount, charCount, isComplex })

return isComplex ? 'complex' : 'simple'`,
      resultPath: 'route.complexity',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    },
    {
      id: 'complexity-condition',
      kind: 'condition',
      name: '复杂度判定',
      enabled: true,
      description: 'route.complexity 等于 complex 视为复杂请求；脚本失败时读不到值，走「其余」。',
      position: { x: 880, y: 300 },
      cases: [complexCase],
    },
    {
      id: 'model-complex',
      kind: 'model-select',
      name: '复杂请求落点',
      enabled: true,
      description: '复杂请求落到这个逻辑模型。',
      position: { x: 1560, y: 140 },
      source: 'fixed',
      variablePath: '',
      modelIds: complexLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-simple',
      kind: 'model-select',
      name: '其余请求落点',
      enabled: true,
      description: '简单请求落到这个逻辑模型。',
      position: { x: 1560, y: 460 },
      source: 'fixed',
      variablePath: '',
      modelIds: simpleLanding,
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1980, y: 300 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    ...ALL_WORKFLOW_PROTOCOLS.map(protocol => ({
      id: `edge-protocol-${protocol}`,
      sourceNodeId: 'protocol',
      sourcePort: protocol,
      targetNodeId: 'complexity-script',
    })),
    { id: 'edge-script-condition', sourceNodeId: 'complexity-script', sourcePort: 'out', targetNodeId: 'complexity-condition' },
    { id: 'edge-condition-complex', sourceNodeId: 'complexity-condition', sourcePort: complexCase.id, targetNodeId: 'model-complex' },
    { id: 'edge-condition-simple', sourceNodeId: 'complexity-condition', sourcePort: 'else', targetNodeId: 'model-simple' },
    { id: 'edge-complex-output', sourceNodeId: 'model-complex', sourcePort: 'out', targetNodeId: 'output' },
    { id: 'edge-simple-output', sourceNodeId: 'model-simple', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/**
 * 策略预设：一键把画布换成某种内置规则，随时可切回默认策略。
 *
 * 注意：这里生成的**图内容**（节点名 / 描述 / 条件名 / 控制项标签 / 脚本与提示词样例）
 * 会随保存落进数据库、并被服务端路由引擎直接执行，属于用户数据而非界面文案，
 * 因此一律不参与界面本地化；只有策略本身的名称与说明（纯展示）放在渲染层目录里。
 */
export const ROUTER_POLICY_PRESETS: RouterPolicyPreset[] = [
  {
    id: 'model-direct',
    isDefault: true,
    createGraph: createDefaultPolicyGraph,
  },
  {
    id: 'ua-source-routing',
    isDefault: false,
    createGraph: createUserAgentGraph,
  },
  {
    id: 'llm-complexity-routing',
    isDefault: false,
    createGraph: createLlmComplexityGraph,
  },
  {
    id: 'script-routing',
    isDefault: false,
    createGraph: createScriptRoutingGraph,
  },
]

export function findPolicyPreset(id: string): RouterPolicyPreset | undefined {
  return ROUTER_POLICY_PRESETS.find(preset => preset.id === id)
}

/**
 * 两张图的内容是否完全一致。
 *
 * 只比较内容、不比较对象身份：判断「当前画布是不是就是最新保存的那一版」以及
 * 「当前画布套的是哪个预设」都靠它，对象永远是新建的，比身份永远不相等。
 */
export function isSameGraph(left: WorkflowGraph, right: WorkflowGraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
