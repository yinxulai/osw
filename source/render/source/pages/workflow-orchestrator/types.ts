export type OrchestratorNodeKind = 'condition' | 'modifier' | 'transformer' | 'route-queue'

export type ConditionOperator = 'eq' | 'contains' | 'gt' | 'exists'
export type ConditionFalseBehavior = 'stop' | 'continue'

export interface ConditionNodeConfig {
  path: string
  value: string
  operator: ConditionOperator
  onFalse: ConditionFalseBehavior
}

export interface ModifierNodeConfig {
  path: string
  value: string
}

export type TransformMode = 'uppercase' | 'lowercase' | 'trim' | 'stringify'

export interface TransformerNodeConfig {
  fromPath: string
  toPath: string
  mode: TransformMode
}

export interface RouteQueueNodeConfig {
  queueId: string
}

interface BaseOrchestratorNode {
  id: string
  name: string
  enabled: boolean
}

export interface ConditionNode extends BaseOrchestratorNode {
  kind: 'condition'
  config: ConditionNodeConfig
}

export interface ModifierNode extends BaseOrchestratorNode {
  kind: 'modifier'
  config: ModifierNodeConfig
}

export interface TransformerNode extends BaseOrchestratorNode {
  kind: 'transformer'
  config: TransformerNodeConfig
}

export interface RouteQueueNode extends BaseOrchestratorNode {
  kind: 'route-queue'
  config: RouteQueueNodeConfig
}

export type OrchestratorNode = ConditionNode | ModifierNode | TransformerNode | RouteQueueNode

export interface NodeExecutionTrace {
  nodeId: string
  nodeName: string
  kind: OrchestratorNodeKind
  skipped: boolean
  success: boolean
  message: string
}

export interface OrchestratorExecutionResult {
  outputPayload: unknown
  targetQueue: string | null
  halted: boolean
  trace: NodeExecutionTrace[]
}
