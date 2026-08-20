import type { Protocol } from '@common/schemas'

export const PROTOCOL_PLACEHOLDERS: Record<Protocol, string> = {
  'openai-completions': 'https://api.openai.com/v1/chat/completions',
  'openai-responses': 'https://api.openai.com/v1/responses',
  'anthropic-messages': 'https://api.anthropic.com/v1/messages',
}

export const PROTOCOL_EXAMPLES: Record<Protocol, { provider: string; url: string }[]> = {
  'openai-completions': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions' },
    { provider: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions' },
    { provider: 'Ollama（本地）', url: 'http://localhost:11434/v1/chat/completions' },
  ],
  'openai-responses': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/responses' },
  ],
  'anthropic-messages': [
    { provider: 'Anthropic', url: 'https://api.anthropic.com/v1/messages' },
  ],
}

export const PROTOCOL_OPTIONS = [
  { value: 'openai-completions' as Protocol, label: 'OpenAI Completions' },
  { value: 'openai-responses' as Protocol, label: 'OpenAI Responses' },
  { value: 'anthropic-messages' as Protocol, label: 'Anthropic Messages' },
]

export const PROTOCOL_SHORT_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI',
  'openai-responses': 'Responses',
  'anthropic-messages': 'Anthropic',
}

/**
 * 每个端点原生协议可接收的转换来源协议（客户端协议）。
 * 与服务端 conversion 注册表保持一致；无条目表示暂不支持转换。
 */
export const CONVERTIBLE_PROTOCOLS: Record<Protocol, Protocol[]> = {
  'openai-completions': ['anthropic-messages', 'openai-responses'],
  'openai-responses': [],
  'anthropic-messages': ['openai-completions'],
}
