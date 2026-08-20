import type { Protocol } from '@common/schemas'

/**
 * 供应商预设：用于新建供应商时快速填充名称和接口地址，
 * 同时为已知供应商提供品牌图标。
 */
export interface ProviderPreset {
  /** 唯一标识 */
  key: string
  /** 显示名称 */
  name: string
  /** 品牌主色（用于图标背景等） */
  color: string
  /** 各协议默认完整接口地址 */
  endpoints: Partial<Record<Protocol, string>>
  /** 品牌图标 SVG 路径内容（在 24x24 viewBox 中） */
  iconPath: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    color: '#10a37f',
    endpoints: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
    iconPath:
      'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1204a4.4708 4.4708 0 0 1-.5346-3.0185l.1415.0852 4.7831 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3686v2.3325a.0804.0804 0 0 1-.0332.0615l-4.8303 2.7867a4.5 4.5 0 0 1-6.1499-1.637zM2.4806 7.2714a4.49 4.49 0 0 1 2.3841-1.9728V11.02a.7664.7664 0 0 0 .3879.6765l5.8144 3.3544-2.02 1.1638a.0757.0757 0 0 1-.071 0l-4.8303-2.782A4.5 4.5 0 0 1 2.4806 7.2714zm16.9908 3.9158L13.6333 7.8328l2.0201-1.1686a.0757.0757 0 0 1 .071 0l4.8303 2.7866a4.4992 4.4992 0 0 1-.6765 8.14v-5.725a.79.79 0 0 0-.407-.6789zm2.124-3.4682l-.1419-.0853-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L10.037 8.244V5.9163a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.5 4.5 0 0 1 6.6892 4.6508zM8.306 12.863l-2.02-1.1637a.0804.0804 0 0 1-.038-.0567V6.0837a4.5 4.5 0 0 1 7.3758-3.4537l-.142.0805L8.704 5.4687a.7948.7948 0 0 0-.3927.6813zm1.074-2.8531l2.6255-1.514 2.6255 1.514v3.028l-2.6255 1.514L9.38 13.038z',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    color: '#d97757',
    endpoints: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
    iconPath:
      'M12 2L2 22h4.5L12 9l5.5 13H22L12 2zm0 7.5L15.5 19h-7L12 9.5z',
  },
  {
    key: 'qiniu',
    name: '七牛云',
    color: '#00bcd4',
    endpoints: {
      'openai-completions': 'https://api.qnaigc.com/v1/chat/completions',
      'anthropic-messages': 'https://api.qnaigc.com/v1/messages',
    },
    iconPath:
      'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM12 18l-4-4h2.5v-3h3v3H16l-4 4z',
  },
]

/**
 * 根据供应商名称匹配预设（大小写不敏感，支持别名）。
 */
const PRESET_ALIASES: Record<string, string> = {
  openai: 'openai',
  'gpt': 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  qiniu: 'qiniu',
  '七牛': 'qiniu',
  '七牛云': 'qiniu',
  modelink: 'qiniu',
  'qnaigc': 'qiniu',
}

export function findPresetByName(name: string): ProviderPreset | undefined {
  const lower = name.trim().toLowerCase()
  // 精确匹配预设 key
  const exact = PROVIDER_PRESETS.find(p => p.key === lower || p.name.toLowerCase() === lower)
  if (exact) return exact
  // 别名匹配
  for (const [alias, key] of Object.entries(PRESET_ALIASES)) {
    if (lower.includes(alias)) {
      return PROVIDER_PRESETS.find(p => p.key === key)
    }
  }
  return undefined
}
