import { z } from 'zod'

import { LogicalModelIdSchema, TransportKindSchema } from '@common/schemas'
import {
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  PROMPT_TIMEOUT_DEFAULT,
  PROMPT_TIMEOUT_LIMIT,
  SCRIPT_TIMEOUT_DEFAULT,
  SCRIPT_TIMEOUT_LIMIT,
} from './types'

/**
 * 运行时注入的逻辑模型快照。
 *
 * 只有**模型 id**（请求里的模型名）与开关：数据记录 id 是本机的内部主键，
 * 不属于可移植的图数据，也不该被入口交进引擎。
 */
const LogicalModelContextSchema = z.object({
  modelId: LogicalModelIdSchema,
  enabled: z.boolean(),
})

const RequestPayloadSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown())

const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WorkflowNodeBaseSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'input',
    'control-input',
    'protocol-discovery',
    'condition',
    'model-select',
    'iteration',
    'script',
    'prompt',
    'note',
    'output',
  ]),
  name: z.string(),
  enabled: z.boolean(),
  description: z.string(),
  position: NodePositionSchema,
})

const ControlInputOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
})

const ControlInputItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(['switch', 'select']),
  enabled: z.boolean(),
  defaultValue: z.union([z.string(), z.boolean()]),
  options: z.array(ControlInputOptionSchema).optional(),
})

const InputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('input'),
})

const ControlInputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('control-input'),
  controls: z.array(ControlInputItemSchema),
})

const ProtocolDiscoveryNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('protocol-discovery'),
})

export const ConditionRuleSchema = z.object({
  fieldPath: z.string().min(1),
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'object', 'unknown']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'gt', 'gte', 'lt', 'lte', 'between', 'isTrue', 'isFalse', 'empty', 'notEmpty', 'exists']),
  // 省略时按字面量比较。
  valueSource: z.enum(['literal', 'field']).default('literal'),
  valueFieldPath: z.string().default(''),
  value: z.string().optional(),
  secondaryValue: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
})

const ConditionCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  logicalOperator: z.enum(['and', 'or']),
  conditions: z.array(ConditionRuleSchema).min(1),
})

const ConditionNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('condition'),
  cases: z.array(ConditionCaseSchema).min(1),
})

const ModelSelectNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('model-select'),
  // 省略时用默认值补齐。
  source: z.enum(['fixed', 'variable']).default('fixed'),
  variablePath: z.string().default(''),
  // 允许空数组：刚插入、尚未选择逻辑模型的节点是合法的编辑中间态，
  // 运行时会产出 success: false 的 trace，而不是让整张图校验失败。
  modelIds: z.array(z.string().min(1)).default([]),
  fallbackModelIds: z.array(z.string().min(1)).default([]),
})

const IterationNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('iteration'),
  // 省略时用默认值补齐（与 model-select 的处理保持一致）。
  // 遍历来源：支持通配投影（`logicalModels[*].modelId`）；数组按元素、对象按键值对遍历。
  sourcePath: z.string().default(''),
  // 每轮结束后读取这条路径判断本轮是否命中；空值视为未命中。
  collectPath: z.string().default('route.modelIds'),
  collectMode: z.enum(['first', 'last', 'list', 'count']).default('first'),
  // 汇总结果写回路径；count 模式写入轮数。
  resultPath: z.string().default('route.modelIds'),
  // 业务预算：轮数上限（全局 MAX_STEPS 是另一层兜底）。
  maxIterations: z.number().int().positive().default(10),
})

const OutputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('output'),
  includeTrace: z.boolean(),
  summaryLevel: z.enum(['brief', 'detailed']),
})

const ScriptNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('script'),
  // 允许空源码：空脚本在运行时会产出 success: false 的 trace，而不是让整张图校验失败。
  code: z.string().default(''),
  resultPath: z.string().default('route.scriptResult'),
  // 沙箱超时上限，限制住死循环；引擎执行前还会再夹一次（同一个上限常量）。
  timeoutMilliseconds: z.number().int().positive().max(SCRIPT_TIMEOUT_LIMIT).default(SCRIPT_TIMEOUT_DEFAULT),
})

const PromptNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('prompt'),
  // 允许空 id：未选择逻辑模型时运行产出 success: false 的 trace。
  logicalModelId: z.string().default(''),
  systemPrompt: z.string().default(''),
  promptTemplate: z.string().default(''),
  resultPath: z.string().default('route.promptResult'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().max(32_768).default(1_024),
  timeoutMilliseconds: z.number().int().positive().max(PROMPT_TIMEOUT_LIMIT).default(PROMPT_TIMEOUT_DEFAULT),
})

const NoteNodeSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
})

const NoteNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('note'),
  // 允许空正文：刚拖出来、还没写字的便签是合法的编辑中间态。
  text: z.string().default(''),
  // 省略时按 `NOTE_DEFAULT_*` 展示；带上就让「同一张图在不同屏幕上尺寸一致」。
  size: NoteNodeSizeSchema.default({ width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }),
})

export const WorkflowNodeModelSchema = z.discriminatedUnion('kind', [
  InputNodeSchema,
  ControlInputNodeSchema,
  ProtocolDiscoveryNodeSchema,
  ConditionNodeSchema,
  ModelSelectNodeSchema,
  IterationNodeSchema,
  ScriptNodeSchema,
  PromptNodeSchema,
  NoteNodeSchema,
  OutputNodeSchema,
])

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourcePort: z.string().min(1),
  targetNodeId: z.string().min(1),
})

/**
 * 画布上的图、版本列表里的图与代理运行时生效的图读的是**同一个 schema**：
 * 「界面看到的那张图」与「真正生效的那张图」因此不可能有两种解释。
 */
export const WorkflowGraphSchema = z.object({
  version: z.literal(1),
  nodes: z.array(WorkflowNodeModelSchema),
  edges: z.array(WorkflowEdgeSchema),
})

export const RouteContextInputSchema = z.object({
  request: RequestPayloadSchema,
  logicalModels: z.array(LogicalModelContextSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** 调用方已经确定的请求协议 / 传输形态；缺省时引擎自行推演 */
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages', 'unknown']).optional(),
  transport: TransportKindSchema.optional(),
})
