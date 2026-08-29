import type { V2ExecutionResult, V2ExecutionTrace, WorkflowV2Node } from './types'

function clonePayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as T
}

function parsePath(path: string): string[] {
  return path.split('.').map(item => item.trim()).filter(Boolean)
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
  if (!segments.length || !payload || typeof payload !== 'object') {
    return false
  }

  let current = payload as Record<string, unknown>
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    const next = current[key]
    if (!next || typeof next !== 'object') {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }

  current[segments[segments.length - 1]] = value
  return true
}

function parseLiteralValue(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
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

function parseDynamicValue(payload: unknown, raw: string): unknown {
  const fullRef = raw.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/)
  if (fullRef) {
    return getByPath(payload, fullRef[1])
  }

  return raw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, path: string) => String(getByPath(payload, path) ?? ''))
}

function evaluateCondition(actual: unknown, operator: 'eq' | 'contains' | 'gt' | 'exists', expected: string): boolean {
  if (operator === 'exists') {
    return actual !== undefined && actual !== null
  }
  if (operator === 'eq') {
    return String(actual ?? '') === expected
  }
  if (operator === 'contains') {
    return String(actual ?? '').includes(expected)
  }
  const currentNumber = Number(actual)
  const expectedNumber = Number(expected)
  return Number.isFinite(currentNumber) && Number.isFinite(expectedNumber) && currentNumber > expectedNumber
}

function transformValue(source: unknown, mode: 'trim' | 'uppercase' | 'lowercase' | 'stringify'): { ok: boolean; value: unknown; message: string } {
  if (mode === 'stringify') {
    return { ok: true, value: JSON.stringify(source), message: '已 stringify' }
  }

  if (typeof source !== 'string') {
    return { ok: false, value: source, message: '仅支持字符串，请先用 stringify 或调整路径' }
  }

  if (mode === 'trim') return { ok: true, value: source.trim(), message: '已 trim' }
  if (mode === 'uppercase') return { ok: true, value: source.toUpperCase(), message: '已 uppercase' }
  return { ok: true, value: source.toLowerCase(), message: '已 lowercase' }
}

function findStartNode(nodes: WorkflowV2Node[]): WorkflowV2Node | null {
  return nodes.find(node => node.kind === 'start') ?? null
}

function nextNodeId(node: WorkflowV2Node, conditionPassed: boolean | null): string {
  if (node.kind === 'start') return node.next
  if (node.kind === 'condition') {
    return conditionPassed ? node.nextTrue : node.nextFalse
  }
  if (node.kind === 'end') return ''
  return node.next
}

export function executeWorkflowV2(nodes: WorkflowV2Node[], payload: unknown): V2ExecutionResult {
  const outputPayload = clonePayload(payload)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const trace: V2ExecutionTrace[] = []
  let queue: string | null = null
  let dispatched = false
  let stoppedReason: V2ExecutionResult['stoppedReason'] = 'missing-next'

  const start = findStartNode(nodes)
  if (!start) {
    return {
      outputPayload,
      targetQueue: null,
      dispatched: false,
      stoppedReason: 'error',
      trace: [{ nodeId: '-', nodeName: '流程初始化', kind: 'start', success: false, message: '流程中缺少 start 节点' }],
    }
  }

  let cursor: WorkflowV2Node | undefined = start
  let step = 0
  while (cursor && step < 64) {
    step += 1
    if (!cursor.enabled) {
      trace.push({ nodeId: cursor.id, nodeName: cursor.name, kind: cursor.kind, success: true, message: '节点禁用，自动跳过' })
      const disabledNext = nextNodeId(cursor, false)
      cursor = disabledNext ? byId.get(disabledNext) : undefined
      if (!cursor) {
        stoppedReason = 'missing-next'
      }
      continue
    }

    if (cursor.kind === 'start') {
      trace.push({ nodeId: cursor.id, nodeName: cursor.name, kind: cursor.kind, success: true, message: '流程开始' })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'condition') {
      const actual = getByPath(outputPayload, cursor.path)
      const passed = evaluateCondition(actual, cursor.operator, cursor.value)
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: passed,
        message: passed ? `命中 true 分支 (${cursor.path})` : `进入 false 分支 (${cursor.path})`,
      })
      cursor = byId.get(passed ? cursor.nextTrue : cursor.nextFalse)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'context-extract') {
      const sourceValue = getByPath(outputPayload, cursor.sourcePath)
      const ok = setByPath(outputPayload, cursor.targetPath, sourceValue)
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: ok,
        message: ok
          ? `提取 ${cursor.sourcePath} -> ${cursor.targetPath}`
          : `提取失败 ${cursor.sourcePath}`,
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'modifier') {
      const ok = setByPath(outputPayload, cursor.path, parseLiteralValue(cursor.value))
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: ok,
        message: ok ? `写入 ${cursor.path}` : `写入失败 ${cursor.path}`,
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'transformer') {
      const source = getByPath(outputPayload, cursor.fromPath)
      const result = transformValue(source, cursor.mode)
      if (result.ok) {
        setByPath(outputPayload, cursor.toPath, result.value)
      }
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: result.ok,
        message: result.ok ? `转换 ${cursor.fromPath} -> ${cursor.toPath}` : result.message,
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'route-queue') {
      queue = cursor.queueId.trim() || queue
      setByPath(outputPayload, 'route.targetQueue', queue)
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: Boolean(cursor.queueId.trim()),
        message: cursor.queueId.trim() ? `设置队列 ${cursor.queueId}` : '队列为空，忽略',
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'dispatch') {
      dispatched = true
      setByPath(outputPayload, 'response.status', cursor.mockStatus)
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: true,
        message: `已分发到 ${queue ?? '未指定队列'}，模拟状态 ${cursor.mockStatus}`,
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    if (cursor.kind === 'response-mutate') {
      const dynamicValue = parseDynamicValue(outputPayload, cursor.value)
      const literalValue = typeof dynamicValue === 'string' ? parseLiteralValue(dynamicValue) : dynamicValue
      const ok = setByPath(outputPayload, cursor.path, literalValue)
      trace.push({
        nodeId: cursor.id,
        nodeName: cursor.name,
        kind: cursor.kind,
        success: ok,
        message: ok ? `响应写入 ${cursor.path}` : `响应写入失败 ${cursor.path}`,
      })
      cursor = byId.get(cursor.next)
      if (!cursor) stoppedReason = 'missing-next'
      continue
    }

    trace.push({ nodeId: cursor.id, nodeName: cursor.name, kind: cursor.kind, success: true, message: '流程结束' })
    stoppedReason = 'end'
    cursor = undefined
  }

  if (step >= 64) {
    stoppedReason = 'max-steps'
  }

  return {
    outputPayload,
    targetQueue: queue,
    dispatched,
    stoppedReason,
    trace,
  }
}
