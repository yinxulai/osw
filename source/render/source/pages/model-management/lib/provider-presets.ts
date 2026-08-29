import { PROVIDER_DEFINITIONS, type ProviderDefinition } from '../../../../../providers'

/**
 * 供应商预设：用于新建供应商时快速填充名称和接口地址，
 * 同时为已知供应商提供品牌图标。
 *
 * 设计原则：
 * - 以“主体/品牌（family）”归组，而不是散乱列出每个模型名。
 * - 如果某个主体缺图，则回落到同主体的主品牌 icon。
 * - 只保留主流官方厂商，避免杂牌图标污染 UI。
 */
export interface ProviderPreset {
  /** 唯一标识 */
  key: string
  /** 显示名称 */
  name: string
  /** 品牌主体归组，用于兜底图标 */
  family?: string
  /** 品牌别名 */
  aliases?: string[]
  /** 品牌主色（用于图标背景等） */
  color: string
  /** 兜底图标键：如果当前主体缺少 icon，则回落到这个主体 */
  fallbackKey?: string
  /** 各协议默认完整接口地址 */
  endpoints: ProviderDefinition['endpoints']
}

export const PROVIDER_PRESETS: ProviderPreset[] = PROVIDER_DEFINITIONS

const PRESET_FALLBACKS: Record<string, string> = {
  openai: 'openai',
  'azure-openai': 'openai',
  'azure openai': 'openai',
  gpt: 'openai',
  chatgpt: 'openai',
  claude: 'anthropic',
  sonnet: 'anthropic',
  haiku: 'anthropic',
  opus: 'anthropic',
  gemini: 'google',
  'vertex-ai': 'google',
  'vertex ai': 'google',
  'google-gemini': 'google',
  llama: 'meta',
  'llama-3': 'meta',
  'meta-llama': 'meta',
  'deepseek-v3': 'deepseek',
  'deepseek-r1': 'deepseek',
  deepseek: 'deepseek',
  grok: 'xai',
  'grok-2': 'xai',
  'grok-3': 'xai',
  qwen: 'qwen',
  dashscope: 'qwen',
  '通义千问': 'qwen',
  '阿里云': 'qwen',
  alibaba: 'qwen',
  kimi: 'moonshot',
  moonshot: 'moonshot',
  'moonshot-v1': 'moonshot',
  wenxin: 'baidu',
  '文心': 'baidu',
  '文心一言': 'baidu',
  ernie: 'baidu',
  baidu: 'baidu',
  qiniu: 'qiniu',
  '七牛': 'qiniu',
  '七牛云': 'qiniu',
  modelink: 'qiniu',
  qnaigc: 'qiniu',
  glm: 'zhipu',
  chatglm: 'zhipu',
  '智谱清言': 'zhipu',
  zhipu: 'zhipu',
  minimax: 'minimax',
  'mini-max': 'minimax',
  'mini max': 'minimax',
  doubao: 'bytedance',
  '豆包': 'bytedance',
  volcengine: 'volcengine',
  '火山': 'volcengine',
  hunyuan: 'tencent',
  '混元': 'tencent',
  tencent: 'tencent',
  nvidia: 'nvidia',
  nemotron: 'nvidia',
}

function resolvePresetKey(name: string): string | undefined {
  const target = name.trim().toLowerCase()
  if (!target) return undefined

  const exact = PROVIDER_PRESETS.find(p => {
    const variants = [p.key, p.name, ...(p.aliases ?? [])].map(v => v.toLowerCase())
    return variants.includes(target)
  })
  if (exact) return exact.key

  const fallbackKey = PRESET_FALLBACKS[target]
  if (fallbackKey) return fallbackKey

  for (const [alias, key] of Object.entries(PRESET_FALLBACKS)) {
    if (target.includes(alias)) return key
  }

  return undefined
}

export function findPresetByName(name: string): ProviderPreset | undefined {
  const key = resolvePresetKey(name)
  if (!key) return undefined
  return PROVIDER_PRESETS.find(p => p.key === key)
}

export function getBuiltInProviderSuggestions(existingProviderNames: string[] = []): ProviderPreset[] {
  const existing = new Set(
    existingProviderNames
      .map(name => name.trim().toLowerCase())
      .filter(Boolean),
  )

  return PROVIDER_PRESETS.filter(preset => {
    const aliases = [preset.key, preset.name, ...(preset.aliases ?? [])]
    return !aliases.some(alias => existing.has(alias.trim().toLowerCase()))
  })
}
