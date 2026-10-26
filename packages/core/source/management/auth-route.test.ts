import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuthSession } from '@common/auth'
import { closeDatabases, initDatabases } from '../database'
import { updateSettings } from '@server/database/settings-store'
import { createAccount } from '@server/database/user-store'
import { resetAuthState } from './auth/service'
import { clearSessions, SESSION_COOKIE_NAME } from './auth/session-store'
import { authRoutes } from './routes/operations/auth'

/**
 * 登录路由的应答体。
 *
 * 这里挡的是一个**只在浏览器里出现**的回归：`/api/auth/login` 曾用
 * `describeSession(req)` 拼应答，而那个函数读的是**请求**里的 `Cookie`。登录成功的票是
 * 写进**响应**的 `Set-Cookie`，请求里按定义不可能已经有它——于是应答自称
 * `authenticated: false`，界面把这份结论存进缓存后判定「没登上」，直接把人退回登录页。
 *
 * 服务端 curl 测不出来：它只看 `Set-Cookie`，再把票带进下一条请求就一切正常。所以这条
 * 断言必须落在**应答体**上，而不是「下一条请求能不能过」。
 */

const USERNAME = 'regression'
const PASSWORD = 'regression-password'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-auth-route-'))
  await initDatabases(temporaryDirectory)
  await createAccount(USERNAME, PASSWORD)
  // 「要登录」= 开关打开 **且** 库里有账号（见 `./auth/service.ts`）。账号上面已经建好，
  // 这里只需要打开开关。
  await updateSettings({ managementAuthEnabled: true })
  resetAuthState()
  clearSessions()
})

afterEach(async () => {
  clearSessions()
  resetAuthState()
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

interface CapturedResponse {
  response: ServerResponse
  body(): string
  header(name: string): string | undefined
}

/** 捕获应答体与响应头。`mockResponse` 把两者都做成了 `vi.fn`，拿不回内容。 */
function captureResponse(): CapturedResponse {
  const headers = new Map<string, string>()
  let body = ''
  const stub = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroy: () => undefined,
    setHeader(name: string, value: string | number | readonly string[]): void {
      headers.set(name.toLowerCase(), String(value))
    },
    end(value?: string | Uint8Array): void {
      body = value === undefined ? '' : Buffer.from(value).toString('utf8')
      stub.writableEnded = true
    },
  }
  return {
    response: stub as unknown as ServerResponse,
    body: () => body,
    header: name => headers.get(name.toLowerCase()),
  }
}

function loginBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { username: USERNAME, password: PASSWORD, ...overrides }
}

describe('login response', () => {
  it('reports the session it just created instead of the one the request did not carry', async () => {
    const captured = captureResponse()

    await authRoutes.invoke('/api/auth/login', captured.response, loginBody({ remember: true }))

    const payload = JSON.parse(captured.body()) as { success: boolean; data: AuthSession }
    expect(payload.success).toBe(true)
    // 这三条就是整个回归：应答必须说「已登录」，且说出是谁、票什么时候过期。
    expect(payload.data).toMatchObject({ required: true, authenticated: true, hasUsers: true, username: USERNAME })
    expect(payload.data.expiresTime).toBeGreaterThan(Date.now())
  })

  it('sets the session cookie the payload describes', async () => {
    const captured = captureResponse()

    await authRoutes.invoke('/api/auth/login', captured.response, loginBody({ remember: true }))

    const cookie = captured.header('set-cookie') ?? ''
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true)
    // `remember` 关掉时是浏览器会话 cookie（没有 `Max-Age`），这里打开了就必须有。
    expect(cookie).toContain('Max-Age=')
    expect(cookie).toContain('HttpOnly')
  })

  it('rejects a wrong password without touching the cookie', async () => {
    const captured = captureResponse()

    await authRoutes.invoke('/api/auth/login', captured.response, loginBody({ password: 'not-the-password' }))

    const payload = JSON.parse(captured.body()) as { success: boolean; errorCode: string }
    expect(payload.success).toBe(false)
    expect(payload.errorCode).toBe('MANAGEMENT_INVALID_CREDENTIALS')
    expect(captured.response.statusCode).toBe(401)
    expect(captured.header('set-cookie')).toBeUndefined()
  })
})

describe('logout response', () => {
  /**
   * 登出与登录**不对称**，而这处不对称是对的：登出时请求里确实还带着那张旧票，所以
   * `describeSession(req)` 读到它是正常的。真正要保证的是「票被吊销了」——应答说已登出，
   * 且那张票再也换不回来。
   */
  it('reports signed out and revokes the ticket', async () => {
    const login = captureResponse()
    await authRoutes.invoke('/api/auth/login', login.response, loginBody())
    const cookie = login.header('set-cookie') ?? ''
    const sessionCookie = cookie.split(';', 1)[0]

    const logout = captureResponse()
    await authRoutes.invoke('/api/auth/logout', logout.response, {}, {
      headers: { host: 'localhost', cookie: sessionCookie },
      method: 'POST',
      url: '/api/auth/logout',
    } as never)

    const payload = JSON.parse(logout.body()) as { success: boolean; data: AuthSession }
    expect(payload.data.authenticated).toBe(false)
    expect(payload.data.username).toBeNull()
    expect(logout.header('set-cookie')).toContain('Max-Age=0')
  })
})
