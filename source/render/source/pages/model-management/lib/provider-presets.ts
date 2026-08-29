import type { Protocol } from '@common/schemas'

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
  /** 实际 SVG 文件名（位于 build/providers/light 或 dark） */
  iconFile: string
  /** 各协议默认完整接口地址 */
  endpoints: Partial<Record<Protocol, string>>
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    family: 'openai',
    aliases: ['gpt', 'chatgpt', 'azure-openai', 'azure openai'],
    color: '#10a37f',
    iconFile: 'openai.svg',
    endpoints: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    family: 'anthropic',
    aliases: ['claude', 'sonnet', 'haiku', 'opus'],
    color: '#d97757',
    iconFile: 'anthropic.svg',
    endpoints: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
  },
  {
    key: 'google',
    name: 'Google',
    family: 'google',
    aliases: ['gemini', 'vertex-ai', 'vertex ai', 'google-gemini'],
    color: '#4285f4',
    iconFile: 'google.svg',
    endpoints: {
      'openai-completions': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'openai-responses': 'https://generativelanguage.googleapis.com/v1beta/openai/responses',
    },
  },
  {
    key: 'meta',
    name: 'Meta',
    family: 'meta',
    aliases: ['llama', 'llama-3', 'meta-llama'],
    color: '#0866ff',
    iconFile: 'meta.svg',
    endpoints: {
      'openai-completions': 'https://api.llama.meta.com/v1/chat/completions',
      'openai-responses': 'https://api.llama.meta.com/v1/responses',
    },
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    family: 'deepseek',
    aliases: ['deepseek-v3', 'deepseek-r1'],
    color: '#4f9cff',
    iconFile: 'deepseek.svg',
    endpoints: {
      'openai-completions': 'https://api.deepseek.com/v1/chat/completions',
      'openai-responses': 'https://api.deepseek.com/v1/responses',
    },
  },
  {
    key: 'xai',
    name: 'xAI',
    family: 'xai',
    aliases: ['grok', 'grok-2', 'grok-3'],
    color: '#000000',
    iconFile: 'grok.svg',
    fallbackKey: 'openai',
    endpoints: {
      'openai-completions': 'https://api.x.ai/v1/chat/completions',
      'openai-responses': 'https://api.x.ai/v1/responses',
    },
  },
  {
    key: 'qwen',
    name: 'Qwen',
    family: 'qwen',
    aliases: ['dashscope', '通义千问', '阿里云', 'alibaba'],
    color: '#3b82f6',
    iconFile: 'qwen.svg',
    endpoints: {
      'openai-completions': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      'openai-responses': 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses',
    },
  },
  {
    key: 'moonshot',
    name: 'Moonshot',
    family: 'moonshot',
    aliases: ['kimi', 'moonshot-v1'],
    color: '#8b5cf6',
    iconFile: 'moonshot.svg',
    endpoints: {
      'openai-completions': 'https://api.moonshot.cn/v1/chat/completions',
      'openai-responses': 'https://api.moonshot.cn/v1/responses',
    },
  },
  {
    key: 'baidu',
    name: '百度',
    family: 'baidu',
    aliases: ['wenxin', '文心', '文心一言', 'ernie'],
    color: '#2b6ae9',
    iconFile: 'baidu.svg',
    endpoints: {
      'openai-completions': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxin/chat/completions',
    },
  },
  {
    key: 'qiniu',
    name: '七牛云',
    family: 'qiniu',
    aliases: ['qiniu', '七牛', '七牛云', 'modelink', 'qnaigc'],
    color: '#00bcd4',
    iconFile: 'qiniu.svg',
    endpoints: {
      'openai-completions': 'https://api.qnaigc.com/v1/chat/completions',
      'openai-responses': 'https://api.qnaigc.com/v1/responses',
      'anthropic-messages': 'https://api.qnaigc.com/v1/messages',
    },
  },
  {
    key: 'zhipu',
    name: '智谱',
    family: 'zhipu',
    aliases: ['glm', 'chatglm', '智谱清言'],
    color: '#f0a400',
    iconFile: 'zhipu.svg',
    endpoints: {
      'openai-completions': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      'openai-responses': 'https://open.bigmodel.cn/api/paas/v4/responses',
    },
  },
  {
    key: 'minimax',
    name: 'MiniMax',
    family: 'minimax',
    aliases: ['mini-max', 'mini max'],
    color: '#30c4a2',
    iconFile: 'minimax.svg',
    endpoints: {
      'openai-completions': 'https://api.minimax.chat/v1/text/chatcompletion_pro',
    },
  },
  {
    key: 'bytedance',
    name: '字节跳动',
    family: 'bytedance',
    aliases: ['doubao', '豆包'],
    color: '#ff4d4f',
    iconFile: 'bytedance.svg',
    endpoints: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    key: 'volcengine',
    name: '火山引擎',
    family: 'volcengine',
    aliases: ['火山', ' volc'],
    color: '#ff7a00',
    iconFile: 'volcengine.svg',
    endpoints: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    key: 'tencent',
    name: '腾讯云',
    family: 'tencent',
    aliases: ['hunyuan', '混元', '腾讯'],
    color: '#23b8ff',
    iconFile: 'tencent-cloud-ti.svg',
    endpoints: {
      'openai-completions': 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
      'openai-responses': 'https://api.hunyuan.cloud.tencent.com/v1/responses',
    },
  },
  {
    key: 'nvidia',
    name: 'NVIDIA',
    family: 'nvidia',
    aliases: ['nemotron', 'nvidia-nims'],
    color: '#76b900',
    iconFile: 'nvidia.svg',
    endpoints: {
      'openai-completions': 'https://integrate.api.nvidia.com/v1/chat/completions',
      'openai-responses': 'https://integrate.api.nvidia.com/v1/responses',
    },
  },
]

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
