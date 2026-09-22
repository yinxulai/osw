import type { Protocol } from '@common/schemas'

export type ProviderIconTheme = 'light' | 'dark'

export interface ProviderDefinition {
  key: string
  name: string
  family?: string
  aliases?: string[]
  color: string
  fallbackKey?: string
  /**
   * 展示权重：**数值大的排前面**。
   *
   * 只在内置厂商之间比较（预设快选、内置建议列表的顺序都由它决定）。
   * 用户已添加的供应商顺序不属于这里——那是侧栏拖拽维护的本地顺序。
   */
  order: number
  /** 厂商官网。给「去官网申请 Key / 看文档」这类跳转用；本地服务（Ollama）指向自己的官网。 */
  websiteUrl?: string
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
  // 顺序由 provider.json 的 `order` 决定（大的在前），同权重按 key 兜底，保证排序稳定。
  // 不再按 key 字母序：那等于把厂商的曝光顺序交给目录名的拼写。
  .sort((left, right) => {
    const byOrder = (providerConfigsByKey[right]?.order ?? 0) - (providerConfigsByKey[left]?.order ?? 0)
    return byOrder !== 0 ? byOrder : left.localeCompare(right)
  })
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
