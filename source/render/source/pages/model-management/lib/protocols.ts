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
