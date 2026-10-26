import { describe, expect, it } from 'vitest'
import { getRuntimeProfile } from '@common/runtime-profile'

describe('runtime profile', () => {
  it('keeps development and production resources isolated', () => {
    const development = getRuntimeProfile('development')
    const production = getRuntimeProfile('production')

    expect(development.applicationName).not.toBe(production.applicationName)
    expect(development.dataDirectoryName).not.toBe(production.dataDirectoryName)
    expect(development.proxyPort).not.toBe(production.proxyPort)
    expect(development.managementPort).not.toBe(production.managementPort)
  })

  it('names each environment with the OSW keychain namespace', () => {
    expect(getRuntimeProfile('production').applicationName).toBe('OSW')
    expect(getRuntimeProfile('development').applicationName).toBe('OSW Development')
  })

  it.each(['development', 'production'] as const)(
    'derives the %s management API URL from its management port',
    environment => {
      const profile = getRuntimeProfile(environment)

      expect(profile.managementApiUrl).toBe(`http://${new URL(profile.managementApiUrl).hostname}:${profile.managementPort}/api`)
    },
  )

  // 开发期的主机名必须是 `localhost`：控制台的 Vite dev server 在 `localhost:5173` 上，
  // 而 `localhost` 与 `127.0.0.1` 在浏览器的站点划分里是两个站点——跨站的话
  // `SameSite=Lax` 的会话 cookie 会被直接丢掉，登录在浏览器里永远不成功
  // （服务端 curl 不执行这条规则，所以测不出来）。理由写在 `runtime-profile.ts`。
  it('uses localhost in development so the session cookie is same-site', () => {
    expect(getRuntimeProfile('development').managementApiUrl).toBe('http://localhost:19301/api')
  })
})
