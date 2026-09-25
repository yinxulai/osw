import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigVersionEntry,
  ClientConfigWriteResult,
} from '@common/client-config'
import { closeDatabases, initDatabases } from '../database'
import { clientConfigRoutes } from './routes/operations/client-config'

/**
 * 客户端配置路由。
 *
 * 路由这层只做两件事：请求体校验（zod）与把 service 的结果原样 `sendSuccess` 出去——
 * 「哪些文件可写」的判断在 service 里，所以这里不重复测一遍越界，只确认**拒绝确实会冒到调用方**
 * 而不是被吞成 200。落盘行为由 `client-config/service.test.ts` 覆盖。
 */

const mocks = vi.hoisted(() => ({ home: '' }))

vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => mocks.home }
})

const CLAUDE_FILE = '~/.claude/settings.json'

let temporaryDirectory: string

interface SuccessBody<T> {
  success: boolean
  data: T
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-client-config-route-'))
  mocks.home = temporaryDirectory
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  mocks.home = ''
})

function fileBody(): Record<string, unknown> {
  return { clientKey: 'claude-code', filePath: CLAUDE_FILE }
}

describe('client config routes', () => {
  it('returns the state of a file that is not there yet', async () => {
    const response = await clientConfigRoutes.request('/api/client-config/get', fileBody())
    const body = response.json<SuccessBody<ClientConfigFileState>>()

    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({ success: true, data: { clientKey: 'claude-code', filePath: CLAUDE_FILE, exists: false, autoFill: 'ready' } })
  })

  it('saves content and reads it back', async () => {
    const saved = await clientConfigRoutes.request('/api/client-config/save', { ...fileBody(), content: '{"a":1}', note: '手改' })
    expect(saved.json<SuccessBody<ClientConfigWriteResult>>().data.state).toMatchObject({ exists: true, content: '{"a":1}' })

    const read = await clientConfigRoutes.request('/api/client-config/get', fileBody())
    expect(read.json<SuccessBody<ClientConfigFileState>>().data.content).toBe('{"a":1}')
    expect(fs.readFileSync(path.join(temporaryDirectory, '.claude/settings.json'), 'utf8')).toBe('{"a":1}')
  })

  it('applies the local endpoint and reports the changes', async () => {
    // 调用方只能选模型名；地址与密钥由服务端按自己的监听设置填，所以请求体里没有它们。
    const response = await clientConfigRoutes.request('/api/client-config/apply', {
      ...fileBody(),
      model: 'osw-model',
    })
    const body = response.json<SuccessBody<{ state: ClientConfigFileState; changes: unknown[] }>>()

    expect(body.data.state.detected).toMatchObject({ model: 'osw-model', baseUrl: 'http://127.0.0.1:9300' })
    expect(body.data.changes.length).toBeGreaterThan(0)
  })

  it('lists versions and returns a missing one as null', async () => {
    await clientConfigRoutes.request('/api/client-config/save', { ...fileBody(), content: '{"a":1}' })
    await clientConfigRoutes.request('/api/client-config/save', { ...fileBody(), content: '{"a":2}' })

    const listed = await clientConfigRoutes.request('/api/client-config/versions', fileBody())
    const [version] = listed.json<SuccessBody<ClientConfigVersionEntry[]>>().data
    expect(version).toMatchObject({ preview: '{"a":1}', origin: 'manual' })
    // 列表给的是「回退到这一版后哪些值会变」，不是这一版开头的字符（那永远是一个 `{`）。
    expect(version!.diff).toEqual([{ before: 'a: 2', after: 'a: 1' }])

    const found = await clientConfigRoutes.request('/api/client-config/version/get', { id: version!.id })
    expect(found.json<SuccessBody<{ content: string }>>().data.content).toBe('{"a":1}')

    const missing = await clientConfigRoutes.request('/api/client-config/version/get', { id: 'ccv_nope' })
    // 历史被清空是正常状态：界面要显示「这个版本已经不在了」，不是报错。
    expect(missing.json<SuccessBody<null>>()).toMatchObject({ success: true, data: null })
  })

  it('restores a version', async () => {
    await clientConfigRoutes.request('/api/client-config/save', { ...fileBody(), content: '{"a":1}' })
    await clientConfigRoutes.request('/api/client-config/save', { ...fileBody(), content: '{"a":2}' })
    const listed = await clientConfigRoutes.request('/api/client-config/versions', fileBody())
    const [version] = listed.json<SuccessBody<ClientConfigVersionEntry[]>>().data

    const restored = await clientConfigRoutes.request('/api/client-config/version/restore', { ...fileBody(), id: version!.id })

    expect(restored.json<SuccessBody<ClientConfigWriteResult>>().data.state.content).toBe('{"a":1}')
  })

  it('rejects a missing or malformed body', async () => {
    await expect(clientConfigRoutes.invoke('/api/client-config/get', undefined as never, {})).rejects.toThrow()
    await expect(clientConfigRoutes.invoke('/api/client-config/save', undefined as never, { ...fileBody() })).rejects.toThrow()
  })

  it('lets a refused path surface instead of answering 200', async () => {
    // 拒绝必须冒到调用方（server 的错误处理再翻成 4xx）；被吞成 200 就等于告诉用户「写好了」。
    await expect(
      clientConfigRoutes.request('/api/client-config/get', { clientKey: 'claude-code', filePath: '~/.ssh/id_rsa' }),
    ).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PATH_NOT_ALLOWED', statusCode: 400 })

    await expect(
      clientConfigRoutes.request('/api/client-config/apply', {
        clientKey: 'pi',
        filePath: '~/.pi/agent/settings.json',
        model: 'osw-model',
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_CONFIG_CLIENT_NOT_SUPPORTED' })
  })

  it('summarises every client for the list page', async () => {
    const body = await clientConfigRoutes.request('/api/client-config/overview', {})
    const items = body.json<SuccessBody<ClientConfigOverviewItem[]>>().data

    expect(items.map(item => item.clientKey)).toContain('claude-code')
    // 列表行要展示的三个事实必须在同一次响应里给全，否则界面得再发一轮请求。
    for (const item of items) {
      expect(item.filePath).not.toBe('')
      expect(item.coverage).toBeDefined()
    }
  })

  it('fills one client and writes the local address to disk', async () => {
    const body = await clientConfigRoutes.request('/api/client-config/fill', { clientKey: 'claude-code' })
    const [claude] = body.json<SuccessBody<ClientConfigFillResultItem[]>>().data

    expect(claude).toMatchObject({ clientKey: 'claude-code' })
    expect(claude!.status).not.toBe('failed')
    expect(fs.readFileSync(path.join(temporaryDirectory, '.claude/settings.json'), 'utf8')).toContain('127.0.0.1')
  })

  it('lets an unknown client surface from fill', async () => {
    await expect(clientConfigRoutes.request('/api/client-config/fill', { clientKey: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    })
  })
})
