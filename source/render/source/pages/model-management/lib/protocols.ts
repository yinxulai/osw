import type { Protocol } from '@common/schemas'

export const PROTOCOL_DESCRIPTIONS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI 兼容的 /chat/completions 接口，适用于 OpenAI、DeepSeek、Ollama 等。',
  'openai-responses': 'OpenAI 新一代 /responses 接口，适用于 OpenAI 官方模型。',
  'anthropic-messages': 'Anthropic Claude 的 /messages 接口。',
}

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
