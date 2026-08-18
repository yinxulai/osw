export type RuntimeEnvironment = 'development' | 'production'

export interface RuntimeProfile {
  environment: RuntimeEnvironment
  userDataDirectoryName: string
  proxyPort: number
  managementPort: number
  managementApiUrl: string
}

const PROFILES: Record<RuntimeEnvironment, RuntimeProfile> = {
  development: {
    environment: 'development',
    userDataDirectoryName: 'One Switch Development',
    proxyPort: 19300,
    managementPort: 19301,
    managementApiUrl: 'http://127.0.0.1:19301/api',
  },
  production: {
    environment: 'production',
    userDataDirectoryName: 'One Switch',
    proxyPort: 9300,
    managementPort: 9301,
    managementApiUrl: 'http://127.0.0.1:9301/api',
  },
}

export function getRuntimeProfile(environment: RuntimeEnvironment): RuntimeProfile {
  return PROFILES[environment]
}
