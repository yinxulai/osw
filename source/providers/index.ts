import type { Protocol } from '@common/schemas'

export type ProviderIconTheme = 'light' | 'dark'

export interface ProviderDefinition {
  key: string
  name: string
  family?: string
  aliases?: string[]
  color: string
  fallbackKey?: string
  endpoints: Partial<Record<Protocol, string>>
  iconUrls: Record<ProviderIconTheme, string>
}

type ProviderConfig = Omit<ProviderDefinition, 'iconUrls'>

const providerConfigModules = import.meta.glob('./*/provider.json', {
  eager: true,
  import: 'default',
}) as Record<string, ProviderConfig>

const providerLightIconModules = import.meta.glob('./*/icon.light.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const providerDarkIconModules = import.meta.glob('./*/icon.dark.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const providerLegacyIconModules = import.meta.glob('./*/icon.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function getProviderKeyFromPath(path: string): string {
  const segments = path.split('/')
  return segments[1] ?? ''
}

const providerConfigsByKey = Object.fromEntries(
  Object.entries(providerConfigModules).map(([path, config]) => [getProviderKeyFromPath(path), config] as const),
)

const providerLightIconsByKey = Object.fromEntries(
  Object.entries(providerLightIconModules).map(([path, iconUrl]) => [getProviderKeyFromPath(path), iconUrl] as const),
)

const providerDarkIconsByKey = Object.fromEntries(
  Object.entries(providerDarkIconModules).map(([path, iconUrl]) => [getProviderKeyFromPath(path), iconUrl] as const),
)

const providerLegacyIconsByKey = Object.fromEntries(
  Object.entries(providerLegacyIconModules).map(([path, iconUrl]) => [getProviderKeyFromPath(path), iconUrl] as const),
)

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = Object.keys(providerConfigsByKey)
  .sort((left, right) => left.localeCompare(right))
  .map((key) => {
    const config = providerConfigsByKey[key]
    const lightIconUrl = providerLightIconsByKey[key] ?? providerLegacyIconsByKey[key]
    const darkIconUrl = providerDarkIconsByKey[key] ?? lightIconUrl

    if (!config || !lightIconUrl || !darkIconUrl) {
      throw new Error(`Provider assets are incomplete for "${key}". Expected provider.json plus icon.light.svg/icon.dark.svg.`)
    }

    return {
      ...config,
      iconUrls: {
        light: lightIconUrl,
        dark: darkIconUrl,
      },
    }
  })

export const PROVIDER_DEFINITION_BY_KEY: Record<string, ProviderDefinition> = Object.fromEntries(
  PROVIDER_DEFINITIONS.map(provider => [provider.key, provider] as const),
)

export const PROVIDER_ICON_URL_BY_KEY: Record<string, Record<ProviderIconTheme, string>> = Object.fromEntries(
  PROVIDER_DEFINITIONS.map(provider => [provider.key, provider.iconUrls] as const),
)
