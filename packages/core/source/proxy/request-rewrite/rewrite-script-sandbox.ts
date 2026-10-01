import { createContext, Script } from 'node:vm'
import { getByPath } from '@common/router/engine'
import type { Protocol } from '@common/schemas'

/**
 * 请求修改规则里「脚本」动作的隔离运行时。
 *
 * 与路由图脚本节点（`../capabilities/script-sandbox.ts`）分开实现，因为两者**能看到的上下文
 * 与要交回的东西不一样**：路由脚本读一份 payload 深拷贝、交回一个值写进 `resultPath`；
 * 修改器脚本读的是**当前阶段的报文**（body + headers），交回的是改写后的报文本身。
 * 硬塞进一个模块，只会让「payload 是什么」这件事在两个入口各说各话。
 *
 * 隔离策略与路由脚本沙箱保持一致：
 * - 不给 `require` / `process` / 定时器 / 网络 / 文件系统，只有数据 + `get()` + 受控 `console`；
 * - 关闭 `eval` / `new Function`（`codeGeneration.strings = false`）与 WASM 编译；
 * - 每次执行都有 `timeout`，死循环被中断而不是挂住代理主进程。
 */

/** 沙箱最多回传的日志行数：脚本里刷屏的 `console.log` 不能把 trace 撑爆。 */
const SCRIPT_LOG_LIMIT = 50

/** 脚本看到的阶段信息（只读）。 */
export interface RewriteScriptProtocolContext {
  stage: 'request' | 'response'
  clientProtocol: Protocol
  upstreamProtocol: Protocol
}

export interface RewriteScriptInvocation {
  ruleId: string
  code: string
  timeoutMilliseconds: number
  /** 当前阶段报文；`body` 解析失败时为 `null`，由脚本自行决定是否 `throw`。 */
  body: unknown
  headers: Record<string, string | string[] | undefined>
  /** 脚本可读的协议上下文。 */
  context: RewriteScriptProtocolContext
}

export interface RewriteScriptResult {
  success: boolean
  /** 脚本 `return` 交回的 body；为 `undefined` 表示不改动 body。 */
  body: unknown
  /** 脚本 `return` 交回的 headers；为 `undefined` 表示不改动 headers。 */
  headers: Record<string, string | string[] | undefined> | undefined
  logs: string[]
  error?: string
  durationMilliseconds: number
}

/** 沙箱只能交回可序列化的数据；这里做一次转换，顺手挡掉循环引用与宿主对象。 */
function toSerializable(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  const serialized = toSerializable(value)
  if (serialized === undefined) return String(value)
  return typeof serialized === 'string' ? serialized : JSON.stringify(serialized)
}

/**
 * 在 `node:vm` 上下文里执行修改器脚本。
 *
 * 脚本拿到的是当前阶段报文（`body` / `headers`）加上 `ctx`（阶段与协议）与 `get(路径)`，
 * 用 `return { body, headers }` 交回改写结果。
 */
export function executeRewriteScript(invocation: RewriteScriptInvocation): RewriteScriptResult {
  const startedAt = Date.now()
  const logs: string[] = []
  const pushLog = (level: string, args: unknown[]) => {
    if (logs.length >= SCRIPT_LOG_LIMIT) return
    logs.push(`[${level}] ${args.map(formatLogArgument).join(' ')}`)
  }

  const sandbox = {
    body: invocation.body,
    headers: invocation.headers,
    protocol: invocation.context,
    get: (path: unknown) => getByPath(invocation.body, String(path ?? '')),
    console: {
      log: (...args: unknown[]) => pushLog('log', args),
      warn: (...args: unknown[]) => pushLog('warn', args),
      error: (...args: unknown[]) => pushLog('error', args),
    },
  }

  try {
    const context = createContext(sandbox, {
      name: `rewrite-script-${invocation.ruleId}`,
      codeGeneration: { strings: false, wasm: false },
    })
    const script = new Script(`"use strict";\n(function () {\n${invocation.code}\n})()`, {
      filename: `rewrite-script-${invocation.ruleId}.js`,
    })
    const value = script.runInContext(context, { timeout: invocation.timeoutMilliseconds }) as unknown
    const outcome = normalizeOutcome(value)
    return {
      success: true,
      body: outcome.body,
      headers: outcome.headers,
      logs,
      durationMilliseconds: Date.now() - startedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      body: undefined,
      headers: undefined,
      logs,
      error: message.includes('Script execution timed out')
        ? `Script execution timed out (> ${invocation.timeoutMilliseconds} ms), aborted`
        : message,
      durationMilliseconds: Date.now() - startedAt,
    }
  }
}

/**
 * 脚本交回的报文。
 *
 * 约定与 §脚本动作一致：`return` 一个对象时按 `{ body, headers }` 取值；返回 `undefined`
 * （或返回不含这两个键的对象）表示这一项不改动 —— 引擎会保留原值。
 */
function normalizeOutcome(value: unknown): { body: unknown; headers: Record<string, string | string[] | undefined> | undefined } {
  if (value === undefined || value === null) return { body: undefined, headers: undefined }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The script must return an object shaped like { body, headers }, or nothing to leave the payload unchanged')
  }
  const record = value as Record<string, unknown>
  const hasBody = Object.prototype.hasOwnProperty.call(record, 'body')
  const hasHeaders = Object.prototype.hasOwnProperty.call(record, 'headers')
  return {
    body: hasBody ? toSerializable(record.body) : undefined,
    headers: hasHeaders ? normalizeHeaders(record.headers) : undefined,
  }
}

function normalizeHeaders(value: unknown): Record<string, string | string[] | undefined> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The script must return headers as a flat object')
  }
  const headers: Record<string, string | string[] | undefined> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined) { headers[key] = undefined; continue }
    if (Array.isArray(raw)) { headers[key] = raw.map(item => String(item)); continue }
    if (raw === null) { headers[key] = ''; continue }
    headers[key] = typeof raw === 'string' ? raw : String(raw)
  }
  return headers
}
