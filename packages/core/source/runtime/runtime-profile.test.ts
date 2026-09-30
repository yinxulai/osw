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

      expect(profile.managementApiUrl).toBe(`http://127.0.0.1:${profile.managementPort}/api`)
    },
  )
})