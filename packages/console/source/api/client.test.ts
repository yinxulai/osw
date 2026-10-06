// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRuntimeProfile } from '@common/runtime-profile'

/**
 * `api/client.ts` 的基地址解析与三种错误信封。
 *
 * 这个模块有模块级记忆（`resolvedApiBase`），所以每个用例都要先 `vi.resetModules()`
 * 再动态 `import`，否则第二个用例会读到第一个用例算出来的地址。
 */
async function loadClient() {
  vi.resetModules()
  return import('./client')
}

/** `window.__OSW__` 只由 preload 注入；浏览器形态下它就是 undefined。 */
function injectApiBase(apiBase: string | undefined) {
  if (apiBase === undefined) delete (window as { __OSW__?: unknown }).__OSW__
  else (window as { __OSW__?: { apiBase?: string } }).__OSW__ = { apiBase }
}

interface StubLocationShape { protocol: string; origin: string }

/** jsdom 默认是 `http://localhost:3000`；这里换成需要的来源，返回还原函数。 */
function stubLocation(location: StubLocationShape) {
  const original = window.location
  Object.defineProperty(window, 'location', { value: location, configurable: true, writable: true })
  return () => Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('resolveApiBase', () => {
  let restoreLocation: (() => void) | null = null

  beforeEach(() => {
    injectApiBase(undefined)
  })

  afterEach(() => {
    restoreLocation?.()
    restoreLocation = null
    injectApiBase(undefined)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // 开发期的判断必须放在同源判断**之前**：Vite dev server 也是 `http:`，
  // 按同源拼会把请求指到 5173 而不是管理服务的 19301 上。
  it('开发期即使页面是 http:，也用构建期预设端口而不是同源', async () => {
    restoreLocation = stubLocation({ protocol: 'http:', origin: 'http://localhost:5173' })
    const { resolveApiBase } = await loadClient()

    expect(resolveApiBase()).toBe(getRuntimeProfile('development').managementApiUrl)
    expect(resolveApiBase()).toBe('http://127.0.0.1:19301/api')
  })

  // 宿主注入了就照办：Electron 从 `file://` 加载页面，靠 URL 推不出管理服务在哪儿。
  it('宿主注入的地址优先，并去掉结尾的斜杠', async () => {
    restoreLocation = stubLocation({ protocol: 'file:', origin: 'null' })
    injectApiBase('http://127.0.0.1:8123/api///')
    const { resolveApiBase } = await loadClient()

    expect(resolveApiBase()).toBe('http://127.0.0.1:8123/api')
  })

  // 浏览器形态（命令行托管）页面就是管理服务发出来的，`/api` 就在旁边。
  it('生产期页面本身就是管理服务时按同源拼 /api', async () => {
    vi.stubEnv('DEV', false)
    restoreLocation = stubLocation({ protocol: 'http:', origin: 'http://127.0.0.1:9301' })
    const { resolveApiBase } = await loadClient()

    expect(resolveApiBase()).toBe('http://127.0.0.1:9301/api')
  })

  it('生产期 https: 同样按同源拼 /api', async () => {
    vi.stubEnv('DEV', false)
    restoreLocation = stubLocation({ protocol: 'https:', origin: 'https://example.com' })
    const { resolveApiBase } = await loadClient()

    expect(resolveApiBase()).toBe('https://example.com/api')
  })

  // Electron 生产形态：`file://` 既不是 http 也不是 https，只能退回预设端口。
  it('生产期 file:// 退回构建期预设端口', async () => {
    vi.stubEnv('DEV', false)
    restoreLocation = stubLocation({ protocol: 'file:', origin: 'null' })
    const { resolveApiBase } = await loadClient()

    expect(resolveApiBase()).toBe(getRuntimeProfile('production').managementApiUrl)
    expect(resolveApiBase()).toBe('http://127.0.0.1:9301/api')
  })

  it('算一次就记住，后续注入的变化不再影响结果', async () => {
    const { resolveApiBase } = await loadClient()

    const first = resolveApiBase()
    injectApiBase('http://127.0.0.1:8123/api')

    expect(resolveApiBase()).toBe(first)
  })
})

describe('request', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('拼上基地址、固定 POST、带 JSON 请求头，并原样回传成功信封', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { id: 'prov_1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { request, resolveApiBase } = await loadClient()

    const result = await request<{ id: string }>('/provider/get', { id: 'prov_1' })

    expect(result).toEqual({ success: true, data: { id: 'prov_1' } })
    expect(fetchMock).toHaveBeenCalledWith(`${resolveApiBase()}/provider/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'prov_1' }),
      signal: undefined,
    })
  })

  it('不传 body 时发一个空对象而不是 undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const { request } = await loadClient()

    await request('/settings/get')

    expect(fetchMock.mock.calls[0][1].body).toBe('{}')
  })

  it('把调用方的 AbortSignal 透传给 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const { request } = await loadClient()
    const controller = new AbortController()

    await request('/model-test/run', {}, { signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  // 服务没起来时常见的其实是「返回了一张 HTML 错误页」；当成 JSON 解析只会抛出
  // 一句 JSON 语法错误，真正的原因（端点不存在）反而看不见了。
  it('响应不是 JSON 时回 INVALID_RESPONSE，消息里带上 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
    ))
    const { request } = await loadClient()

    expect(await request('/provider/list')).toEqual({
      success: false,
      errorCode: 'INVALID_RESPONSE',
      errorMessage: 'management service returned a non-JSON response (HTTP 404)',
    })
  })

  it('完全没有 content-type 时也算非 JSON 响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })))
    const { request } = await loadClient()

    expect(await request('/provider/list')).toMatchObject({ errorCode: 'INVALID_RESPONSE' })
  })

  // 服务端把失败写进了 `{ success: false }`（比如 400 + 业务错误码）：那是**它的**判断，
  // 界面要按 `errorCode` 本地化，不能被覆盖成一句笼统的 HTTP_ERROR。
  it('HTTP 失败但响应体自带失败信封时，原样透传服务端的错误码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: false, errorCode: 'VALIDATION_ERROR', errorMessage: 'name is required' }, 400),
    ))
    const { request } = await loadClient()

    expect(await request('/provider/create', { name: '' })).toEqual({
      success: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'name is required',
    })
  })

  // 反过来：HTTP 已经不是 2xx，响应体却说自己成功，那这个「成功」不能信。
  it('HTTP 失败但响应体声称成功时，改成 HTTP_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }, 502)))
    const { request } = await loadClient()

    expect(await request('/provider/list')).toEqual({
      success: false,
      errorCode: 'HTTP_ERROR',
      errorMessage: 'management service request failed (HTTP 502)',
    })
  })

  // `request` 从不 reject：调用方只检查 `success`，不必到处包 try/catch。
  it('fetch 抛错时回 NETWORK_ERROR 并带上原始消息，不向外抛', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { request } = await loadClient()

    await expect(request('/provider/list')).resolves.toEqual({
      success: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'Failed to fetch',
    })
  })
})

describe('openStream', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('与 request 同一条通路，但把响应体直接交出去', async () => {
    const body = new ReadableStream<Uint8Array>()
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { openStream, resolveApiBase } = await loadClient()

    await expect(openStream('/live-request/stream')).resolves.toBe(body)
    expect(fetchMock).toHaveBeenCalledWith(`${resolveApiBase()}/live-request/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: undefined,
    })
  })

  // 把一张错误页当成流去逐行解析，只会在界面上留下一堆解析失败；
  // 真正的原因（服务没起来、端点不存在）必须在打开流这一步就抛出来。
  it('非 2xx 直接抛错并带上状态码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))
    const { openStream } = await loadClient()

    await expect(openStream('/live-request/stream')).rejects.toThrow('management service refused the stream (HTTP 503)')
  })

  it('没有响应体（例如 204）也按拒绝处理', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    const { openStream } = await loadClient()

    await expect(openStream('/live-request/stream')).rejects.toThrow('management service refused the stream (HTTP 204)')
  })

  it('把调用方的 AbortSignal 透传给 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { openStream } = await loadClient()
    const controller = new AbortController()

    await openStream('/live-request/stream', { signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})
