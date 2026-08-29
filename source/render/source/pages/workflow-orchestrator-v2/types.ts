export type V2NodeKind =
  | 'start'
  | 'context-extract'
  | 'condition'
  | 'modifier'
  | 'transformer'
  | 'route-queue'
  | 'dispatch'
  | 'response-mutate'
  | 'end'

interface BaseV2Node {
  id: string
  kind: V2NodeKind
  name: string
  enabled: boolean
  x: number
  y: number
}

export interface StartV2Node extends BaseV2Node {
  kind: 'start'
  next: string
}

export interface EndV2Node extends BaseV2Node {
  kind: 'end'
}

export interface ConditionV2Node extends BaseV2Node {
  kind: 'condition'
  path: string
  operator: 'eq' | 'contains' | 'gt' | 'exists'
  value: string
  nextTrue: string
  nextFalse: string
}

export interface ContextExtractV2Node extends BaseV2Node {
  kind: 'context-extract'
  sourcePath: string
  targetPath: string
  next: string
}

export interface ModifierV2Node extends BaseV2Node {
  kind: 'modifier'
  path: string
  value: string
  next: string
}

export interface TransformerV2Node extends BaseV2Node {
  kind: 'transformer'
  fromPath: string
  toPath: string
  mode: 'trim' | 'uppercase' | 'lowercase' | 'stringify'
  next: string
}

export interface QueueRouteV2Node extends BaseV2Node {
  kind: 'route-queue'
  queueId: string
  next: string
}

export interface DispatchV2Node extends BaseV2Node {
  kind: 'dispatch'
  mockStatus: number
  next: string
}

export interface ResponseMutateV2Node extends BaseV2Node {
  kind: 'response-mutate'
  path: string
  value: string
  next: string
}

export type WorkflowV2Node =
  | StartV2Node
  | EndV2Node
  | ContextExtractV2Node
  | ConditionV2Node
  | ModifierV2Node
  | TransformerV2Node
  | QueueRouteV2Node
  | DispatchV2Node
  | ResponseMutateV2Node

export interface V2Edge {
  id: string
  from: string
  to: string
  label?: string
}

export interface V2ExecutionTrace {
  nodeId: string
  nodeName: string
  kind: V2NodeKind
  success: boolean
  message: string
}

export interface V2ExecutionResult {
  outputPayload: unknown
  targetQueue: string | null
  dispatched: boolean
  stoppedReason: 'end' | 'missing-next' | 'max-steps' | 'error'
  trace: V2ExecutionTrace[]
}
