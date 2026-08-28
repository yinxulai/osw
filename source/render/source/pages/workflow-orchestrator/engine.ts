import type {
  ConditionOperator,
  NodeExecutionTrace,
  OrchestratorExecutionResult,
  OrchestratorNode,
  TransformMode,
} from './types'

function clonePayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as T
}

function parsePath(path: string): string[] {
  return path.split('.').map(part => part.trim()).filter(Boolean)
}

function getByPath(payload: unknown, path: string): unknown {
  const segments = parsePath(path)
  let current: unknown = payload
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setByPath(payload: unknown, path: string, value: unknown): boolean {
  const segments = parsePath(path)
  if (segments.length === 0 || !payload || typeof payload !== 'object') {
    return false
  }

  let current: Record<string, unknown> = payload as Record<string, unknown>
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const nextValue = current[segment]
    if (!nextValue || typeof nextValue !== 'object') {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  current[segments[segments.length - 1]] = value
  return true
}

function parseLiteralValue(raw: string): unknown {
  const value = raw.trim()
  if (value === '') return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)

  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return raw
    }
  }

  return raw
}

function evaluateCondition(operator: ConditionOperator, currentValue: unknown, expected: string): boolean {
  switch (operator) {
    case 'exists':
      return currentValue !== undefined && currentValue !== null
    case 'eq':
      return String(currentValue ?? '') === expected
    case 'contains':
      return String(currentValue ?? '').includes(expected)
    case 'gt': {
      const current = Number(currentValue)
      const target = Number(expected)
      return Number.isFinite(current) && Number.isFinite(target) && current > target
    }
    default:
      return false
  }
}

function applyTransform(value: unknown, mode: TransformMode): { success: boolean; value: unknown; message: string } {
  if (mode === 'stringify') {
    return { success: true, value: JSON.stringify(value), message: '已将值序列化为 JSON 字符串' }
  }

  if (typeof value !== 'string') {
    return { success: false, value, message: '转换器仅支持字符串（当前可改用 stringify）' }
  }

  if (mode === 'uppercase') {
    return { success: true, value: value.toUpperCase(), message: '已转为大写' }
  }

  if (mode === 'lowercase') {
    return { success: true, value: value.toLowerCase(), message: '已转为小写' }
  }

  return { success: true, value: value.trim(), message: '已去除首尾空白' }
}

export function executeOrchestrator(nodes: OrchestratorNode[], inputPayload: unknown): OrchestratorExecutionResult {
  const outputPayload = clonePayload(inputPayload)
  const trace: NodeExecutionTrace[] = []
  let halted = false
  let targetQueue: string | null = null

  for (const node of nodes) {
    if (!node.enabled) {
      trace.push({
        nodeId: node.id,
        nodeName: node.name,
        kind: node.kind,
        skipped: true,
        success: true,
        message: '节点已禁用，跳过',
      })
      continue
    }

    if (node.kind === 'condition') {
      const actual = getByPath(outputPayload, node.config.path)
      const passed = evaluateCondition(node.config.operator, actual, node.config.value)
      if (!passed && node.config.onFalse === 'stop') {
        halted = true
      }
      trace.push({
        nodeId: node.id,
        nodeName: node.name,
        kind: node.kind,
        skipped: false,
        success: passed,
        message: passed
          ? `条件命中：${node.config.path}`
          : node.config.onFalse === 'stop'
            ? `条件未命中，流程终止：${node.config.path}`
            : `条件未命中，继续执行：${node.config.path}`,
      })
      if (halted) break
      continue
    }

    if (node.kind === 'modifier') {
      const value = parseLiteralValue(node.config.value)
      const ok = setByPath(outputPayload, node.config.path, value)
      trace.push({
        nodeId: node.id,
        nodeName: node.name,
        kind: node.kind,
        skipped: false,
        success: ok,
        message: ok ? `已写入 ${node.config.path}` : `写入失败：${node.config.path}`,
      })
      continue
    }

    if (node.kind === 'transformer') {
      const source = getByPath(outputPayload, node.config.fromPath)
      const transformed = applyTransform(source, node.config.mode)
      if (transformed.success) {
        setByPath(outputPayload, node.config.toPath, transformed.value)
      }
      trace.push({
        nodeId: node.id,
        nodeName: node.name,
        kind: node.kind,
        skipped: false,
        success: transformed.success,
        message: transformed.success
          ? `转换完成：${node.config.fromPath} -> ${node.config.toPath}`
          : `转换失败：${node.config.fromPath}（${transformed.message}）`,
      })
      continue
    }

    if (node.kind === 'route-queue') {
      const queueId = node.config.queueId.trim()
      targetQueue = queueId || null
      trace.push({
        nodeId: node.id,
        nodeName: node.name,
        kind: node.kind,
        skipped: false,
        success: Boolean(queueId),
        message: queueId ? `路由到队列：${queueId}` : '队列为空，未设置路由目标',
      })
    }
  }

  return {
    outputPayload,
    targetQueue,
    halted,
    trace,
  }
}
