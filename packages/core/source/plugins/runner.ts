import { Worker } from 'node:worker_threads'
import type { PluginCredentialResult, PluginHttpRequest, PluginHttpResponse, PluginListModelsResult, PluginRequestResolutionResult } from '@common/plugin'
import { PluginCredentialResultSchema, PluginListModelsResultSchema, PluginRequestResolutionResultSchema } from '@common/plugin'
import { coreNetworkClient } from '../infrastructure/network/core-network'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { pluginRunFailedError, pluginTimeoutError } from '../errors'
import { PLUGIN_WORKER_SOURCE } from './worker-source'
import type { ScannedPlugin } from './manifest'
import { pluginSecretReference, readPluginStorageValue, writePluginStorageValue } from './state'

/**
 * 插件沙箱的执行入口。
 *
 * 对调用方（同步引擎）来说只有「跑一次 hook，拿到结果或一个错误」；worker、RPC、超时
 * 全在这一层里（见 `apps/docs/specs/plugins.md` §6）。将来换更强的隔离（子进程、isolate）
 * 只改这个文件，`./sync-engine.ts` 一行不动。
 *
 * **每次调用都新建并销毁一个 worker**。没有池、没有缓存——这不是性能取舍，而是正确性：
 * 插件目录即源码目录（§10），改一行 `entry.js` 必须在下一次调用就生效；缓存 worker 等价于
 * 缓存了代码，用户得重启服务才能看到改动，那本地开发就没法用了。
 */

export type PluginHookName = 'obtainCredential' | 'listModels' | 'resolveRequest'

/** 沙箱一次调用最多回传的日志行数：插件里刷屏的 `console.log` 不能把同步结果撑爆。 */
const PLUGIN_LOG_LIMIT = 50

/** worker 的内存上限。插件是别人的代码，不该有吃掉整个宿主堆的机会。 */
const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 }

/**
 * 宿主兜底计时器比插件自己的 `timeoutMilliseconds` 晚一秒钟。
 *
 * 两个计时器同时到点是没法调试的：同一个插件会随线程调度时快时慢地报出 `PLUGIN_TIMEOUT`
 * 或 `PLUGIN_RUN_FAILED`，而这两条对应的处理完全不同。沙箱内部对**模块级同步死循环**有更
 * 具体的诊断（「入口同步执行太久」），因此给它一秒先把话说出来；宿主这一秒是给
 * **挂住的 await**（沙箱内部拦不住）准备的。
 */
const PLUGIN_TIMEOUT_GRACE_MILLISECONDS = 1000

export interface PluginRunContext {
  plugin: ScannedPlugin
  hook: PluginHookName
  /** 用户在设置页填的值（非密钥项）。密钥项由插件通过 `ctx.secrets.get` 取。 */
  inputs: Record<string, string>
  /** 被托管的 Provider 的 id：`storage` 与密钥引用都挂在它身上。 */
  providerId: string
  request?: {
    logicalModelId: string
    providerModelId: string
    providerModelName: string
    protocol: string
    method: string
    path: string
    headers: Record<string, string>
    body: string
    url: string
  }
}

export interface PluginRunResult<T> {
  ok: boolean
  /** 插件没实现这个 hook（正常形态，清单的声明式回退接手），不是失败。 */
  missing: boolean
  value: T | null
  error: string | null
  logs: string[]
  durationMilliseconds: number
  /** 本次调用写入的 SecretStore 引用（含 `secret.set` 与 `storage.set`），供同步引擎记进 `plugin.state`。 */
  secretReferences: string[]
}

/** 一次 hook 调用。抛 `PLUGIN_TIMEOUT` / `PLUGIN_RUN_FAILED`，返回值只表达「插件自己说了什么」。 */
export interface PluginRunner {
  runCredential(context: PluginRunContext): Promise<PluginRunResult<PluginCredentialResult>>
  runListModels(context: PluginRunContext): Promise<PluginRunResult<PluginListModelsResult>>
  runResolveRequest(context: PluginRunContext): Promise<PluginRunResult<PluginRequestResolutionResult>>
}

export const pluginRunner: PluginRunner = {
  runCredential: context => runHook(context, PluginCredentialResultSchema),
  runListModels: context => runHook(context, PluginListModelsResultSchema),
  runResolveRequest: context => runHook(context, PluginRequestResolutionResultSchema),
}

/** zod 报告的一条问题。只用其中两个字段，因此不引 zod 的类型进来。 */
interface SchemaIssue {
  path: PropertyKey[]
  message: string
}

/**
 * 只要能被拿来校验的东西（结构上就是 zod 的 `safeParse`）。
 *
 * 写成接口而不是 `ZodType<T>`：这里只用到「校验一次」，把 zod 的类型引进来会让
 * 「runner 依赖 zod」变成一件看起来必要的事。
 */
interface ParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: SchemaIssue[] } }
}

async function runHook<T>(context: PluginRunContext, schema: ParseSchema<T>): Promise<PluginRunResult<T>> {
  // 这里刻意不取 `context.providerId`：沙箱侧的每一项能力都按**插件 key** 寻址（`§7` 的
  // `plugin::<key>::*` 命名空间），providerId 是同步引擎记账用的，进不了沙箱。
  const { plugin, hook, inputs } = context
  const timeoutMilliseconds = plugin.manifest.timeoutMilliseconds
  const startedAt = Date.now()
  const logs: string[] = []

  if (!plugin.entryPath) {
    return { ok: true, missing: true, value: null, error: null, logs, durationMilliseconds: 0, secretReferences: [] }
  }

  const secretStore = getSecretStore()
  /** 本次调用写入的密钥引用；同步引擎据此记进 `plugin.state.secretReferences`，卸载时按它清理。 */
  const writtenReferences = new Set<string>()

  const worker = new Worker(PLUGIN_WORKER_SOURCE, {
    eval: true,
    workerData: {
      pluginKey: plugin.key,
      entryPath: plugin.entryPath,
      hookName: hook,
      // worker 只拿得到「用户在设置页填的非密钥项」；密钥一律现取现给（见 handleRpc），
      // 不随 workerData 一起复制进沙箱——那份数据在 worker 的整个生命周期里都躺在堆上。
      inputs,
      request: context.request ?? null,
      timeoutMilliseconds,
    },
    resourceLimits: WORKER_RESOURCE_LIMITS,
  })

  return await new Promise<PluginRunResult<T>>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate()
        reject(pluginTimeoutError(plugin.key, hook, timeoutMilliseconds))
      })
    }, timeoutMilliseconds + PLUGIN_TIMEOUT_GRACE_MILLISECONDS)

    function finish(action: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 超时路径自己负责 terminate；其余路径（正常收尾、报错）都要顺手杀掉 worker，
      // 否则一次失败的调用会留下一个空转的线程。
      action()
    }

    worker.on('message', (message: WorkerMessage) => {
      if (!message || typeof message !== 'object') return
      if (message.kind === 'rpc') {
        void handleRpc(message).catch(error => {
          rejectRun(error instanceof Error ? error.message : String(error))
        })
        return
      }
      if (message.kind !== 'result') return

      finish(() => {
        void worker.terminate()
        const durationMilliseconds = Date.now() - startedAt
        if (message.missing) {
          resolve({ ok: true, missing: true, value: null, error: null, logs, durationMilliseconds, secretReferences: [...writtenReferences] })
          return
        }
        if (!message.ok) {
          reject(pluginRunFailedError(plugin.key, hook, message.error ?? 'The plugin did not report a reason'))
          return
        }
        let raw: unknown
        try {
          raw = JSON.parse(message.value ?? 'null')
        } catch (error) {
          reject(pluginRunFailedError(plugin.key, hook, `the returned value is not valid JSON: ${(error as Error).message}`))
          return
        }
        const parsed = schema.safeParse(raw)
        if (!parsed.success) {
          reject(pluginRunFailedError(plugin.key, hook, `the returned value does not match the hook contract: ${formatIssues(parsed.error.issues)}`))
          return
        }
        resolve({ ok: true, missing: false, value: parsed.data, error: null, logs, durationMilliseconds, secretReferences: [...writtenReferences] })
      })
    })

    worker.on('error', error => {
      finish(() => {
        void worker.terminate()
        reject(pluginRunFailedError(plugin.key, hook, error.message))
      })
    })

    worker.on('exit', code => {
      // 已经收过结果时 `settled` 为真，这里是 terminate 自己触发的那次退出，安静收场。
      finish(() => {
        if (code === 0) resolve({ ok: true, missing: true, value: null, error: null, logs, durationMilliseconds: Date.now() - startedAt, secretReferences: [...writtenReferences] })
        else reject(pluginRunFailedError(plugin.key, hook, `the plugin worker exited with code ${code}`))
      })
    })

    function rejectRun(message: string): void {
      finish(() => {
        void worker.terminate()
        reject(pluginRunFailedError(plugin.key, hook, message))
      })
    }

    async function handleRpc(message: RpcRequest): Promise<void> {
      try {
        const value = await dispatchRpc(message, { plugin, hook, secretStore, writtenReferences, logs })
        if (settled) return
        worker.postMessage({ kind: 'rpc-result', id: message.id, value })
      } catch (error) {
        if (settled) return
        // RPC 失败只回给沙箱一句错误：插件可以自己 `try/catch` 并降级，
        // 不是宿主替它判死刑（真正的失败是它把这个异常抛出来）。
        worker.postMessage({ kind: 'rpc-result', id: message.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
  })
}

function formatIssues(issues: SchemaIssue[]): string {
  return issues.map(issue => `${issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'}: ${issue.message}`).join('; ')
}

interface RpcHost {
  plugin: ScannedPlugin
  hook: PluginHookName
  secretStore: ReturnType<typeof getSecretStore>
  writtenReferences: Set<string>
  logs: string[]
}

interface RpcRequest {
  kind: 'rpc'
  id: number
  method: string
  args: string
}

type WorkerMessage = RpcRequest | { kind: 'result'; ok: boolean; value?: string; missing?: boolean; error?: string }

/**
 * 沙箱要的每一样东西都在这里落地。
 *
 * **白名单式分发**：`method` 名对不上就直接失败，没有「默认分支」。这一段代码是沙箱唯一的
 * 能力边界，写成 `switch` 而不是查表，是为了让「插件能做什么」在文件里一眼可数。
 */
async function dispatchRpc(message: RpcRequest, host: RpcHost): Promise<string> {
  const args = parseArgs(message.args)
  switch (message.method) {
    case 'log': {
      const [level, text] = args
      pushLog(host.logs, String(level ?? 'log'), String(text ?? ''))
      return 'null'
    }
    case 'secret.get': {
      const name = requiredString(args[0], 'secret name')
      // 先看用户填的密钥输入项，再看 hook 自己写过的：声明 `secret: true` 的项对插件来说
      // 就是「一个已经存在的密钥」，等价于 `ctx.secrets.get('<inputKey>')`（§7）。
      const fromInput = await host.secretStore.get(pluginSecretReference(host.plugin.key, 'input', name))
      if (fromInput !== null) return JSON.stringify(fromInput)
      return JSON.stringify(await host.secretStore.get(pluginSecretReference(host.plugin.key, 'hook', name)))
    }
    case 'secret.set': {
      const name = requiredString(args[0], 'secret name')
      const value = requiredString(args[1], 'secret value')
      const reference = pluginSecretReference(host.plugin.key, 'hook', name)
      await host.secretStore.set(reference, value)
      host.writtenReferences.add(reference)
      return 'null'
    }
    case 'secret.delete': {
      const name = requiredString(args[0], 'secret name')
      await host.secretStore.delete(pluginSecretReference(host.plugin.key, 'hook', name))
      return 'null'
    }
    case 'storage.get': {
      const name = requiredString(args[0], 'storage name')
      return JSON.stringify(await readPluginStorageValue(host.plugin.key, name))
    }
    case 'storage.set': {
      const name = requiredString(args[0], 'storage name')
      const value = requiredString(args[1], 'storage value')
      const reference = pluginSecretReference(host.plugin.key, 'storage', name)
      await writePluginStorageValue(host.plugin.key, name, value)
      host.writtenReferences.add(reference)
      return 'null'
    }
    case 'http': {
      const request = parseHttpRequest(args[0])
      return JSON.stringify(await performHttp(request, host.plugin.manifest.timeoutMilliseconds))
    }
    default:
      throw new Error(`The plugin called an unknown host method: ${message.method}`)
  }
}

function parseArgs(args: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(args)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function requiredString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The plugin passed an invalid ${what}`)
  return value
}

function pushLog(logs: string[], level: string, text: string): void {
  if (logs.length >= PLUGIN_LOG_LIMIT) return
  logs.push(`[${level}] ${text}`)
}

function parseHttpRequest(value: unknown): PluginHttpRequest {
  if (value === null || typeof value !== 'object') throw new Error('ctx.http() needs a request object')
  const record = value as Record<string, unknown>
  const url = requiredString(record.url, 'url')
  const headers: Record<string, string> = {}
  if (record.headers && typeof record.headers === 'object') {
    for (const [key, header] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof header === 'string') headers[key] = header
    }
  }
  return {
    url,
    method: typeof record.method === 'string' ? record.method : 'GET',
    headers,
    body: typeof record.body === 'string' ? record.body : undefined,
  }
}

/**
 * 插件的唯一出站口。
 *
 * 走 `coreNetworkClient`，因此**与代理同一套出站代理设置**（§12）：插件不是遥测链路，
 * 不享受「唯一允许直连」的例外。顺带也就继承了同一套口径——请求与响应都不设大小上限。
 */
async function performHttp(request: PluginHttpRequest, timeoutMilliseconds: number): Promise<PluginHttpResponse> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    throw new Error(`Invalid url: ${request.url}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported url protocol: ${url.protocol}`)
  const method = (request.method ?? 'GET').toUpperCase()
  const body = request.body === undefined ? Buffer.alloc(0) : Buffer.from(request.body, 'utf8')
  const response = await coreNetworkClient.requestHttpBuffered(url, {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: request.headers ?? {},
    timeout: timeoutMilliseconds,
  }, body)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) {
    if (typeof value === 'string') headers[key] = value
    else if (Array.isArray(value)) headers[key] = value.join(', ')
  }
  return { status: response.statusCode, headers, body: response.body }
}
