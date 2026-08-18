import { describe, expect, it } from 'vitest'
import { getRuntimeProfile } from '@common/runtime-profile'

describe('runtime profile', () => {
  it('keeps development and production resources isolated', () => {
    const development = getRuntimeProfile('development')
    const production = getRuntimeProfile('production')

    expect(development.userDataDirectoryName).not.toBe(production.userDataDirectoryName)
    expect(development.proxyPort).not.toBe(production.proxyPort)
    expect(development.managementPort).not.toBe(production.managementPort)
  })

  it.each(['development', 'production'] as const)(
    'derives the %s management API URL from its management port',
    environment => {
      const profile = getRuntimeProfile(environment)

      expect(profile.managementApiUrl).toBe(`http://127.0.0.1:${profile.managementPort}/api`)
    },
  )
})