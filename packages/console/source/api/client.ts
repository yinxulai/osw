import type { ApiResponse } from '@common/schemas'
import { getRuntimeProfile } from '@common/runtime-profile'

interface RequestOptions {
  signal?: AbortSignal
}

/**
 * 管理 API 的基地址。
 *
 * 控制台产物只编一份，却要在三种形态下都能找到管理服务，所以基地址必须在**运行时**算：
 *
 * 1. 宿主显式注入（`window.__OSW__`）——注入了就照办；
 * 2. 页面本身就是管理服务发出来的（`http(s):`）——同源，`/api` 就在旁边，
 *    命令行形态的托管走这条；
 * 3. 其余（Electron 的 `file://`、Vite dev server）——退回构建期预设端口。
 *
 * 顺序里有个坑：Vite dev server 也是 `http:`，但它不是管理服务，同源拼接会指到 5173
 * 上去。所以开发期的判断必须放在同源判断**之前**（见 `docs/product/packaging.md` §5.3）。
 */
let resolvedApiBase: string | null = null

export function resolveApiBase(): string {
  if (resolvedApiBase) return resolvedApiBase

  const profile = getRuntimeProfile(import.meta.env.DEV ? 'development' : 'production')
  resolvedApiBase = resolveApiBaseFromEnvironment(profile.managementApiUrl)
  return resolvedApiBase
}

function resolveApiBaseFromEnvironment(fallback: string): string {
  const injected = typeof window === 'undefined' ? undefined : window.__OSW__?.apiBase
  if (injected) return injected.replace(/\/+$/, '')

  if (import.meta.env.DEV) return fallback

  const location = typeof window === 'undefined' ? undefined : window.location
  if (location && (location.protocol === 'http:' || location.protocol === 'https:')) {
    return `${location.origin}/api`
  }

  return fallback
}

/**
 * 管理 API 的请求头。
 *
 * 只有 `Content-Type`：本版本的管理 API 不带凭证（见 `docs/product/security-privacy.md`），
 * 它靠回环监听与 CORS 白名单划边界。
 */
function buildHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

/**
 * 打开一条管理 API 的推送流。
 *
 * 与 `request()` 的唯一区别是它**不读完整份响应**：管理服务会一直往里写，直到任一侧断开。
 * 除这一点之外两者完全同路——同一个基地址、同一套请求头、同一个 `POST` 契约，
 * 因此「只接 `/api/*` 的 `POST` + CORS 白名单」这条边界一条都没破。
 *
 * 非 2xx 的响应在这里就抛：把一张错误页当成流去逐行解析，只会在界面上留下一堆
 * 莫名其妙的解析失败，而真正的原因（服务没起来、端点不存在）反而看不见了。
 */
export async function openStream(path: string, options: RequestOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({}),
    signal: options.signal,
  })
  if (!response.ok || response.body === null) {
    throw new Error(`management service refused the stream (HTTP ${response.status})`)
  }
  return response.body
}

export async function request<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${resolveApiBase()}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      // 诊断消息固定英文；界面按 `errorCode` 本地化（见 `docs/product/i18n.md` §5）。
      return { success: false, errorCode: 'INVALID_RESPONSE', errorMessage: `management service returned a non-JSON response (HTTP ${response.status})` }
    }
    const result = (await response.json()) as ApiResponse<T>
    if (!response.ok && result.success) {
      return { success: false, errorCode: 'HTTP_ERROR', errorMessage: `management service request failed (HTTP ${response.status})` }
    }
    return result
  } catch (error) {
    return { success: false, errorCode: 'NETWORK_ERROR', errorMessage: (error as Error).message }
  }
}
