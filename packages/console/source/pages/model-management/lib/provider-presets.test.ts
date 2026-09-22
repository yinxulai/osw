import { describe, expect, it } from 'vitest'
import { findPresetByName, getBuiltInProviderSuggestions } from './provider-presets'

describe('provider presets', () => {
  it('finds known aliases for built-in providers', () => {
    const preset = findPresetByName('gpt')
    expect(preset?.name).toBe('OpenAI')
  })

  it('resolves Ollama aliases to the built-in local provider', () => {
    const preset = findPresetByName('ollama-local')
    expect(preset?.key).toBe('ollama')
    expect(preset?.endpoints['openai-completions']).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('shows missing built-in providers as suggestions before users create them', () => {
    const suggestions = getBuiltInProviderSuggestions(['OpenAI'])
    expect(suggestions.some(preset => preset.name === 'OpenAI')).toBe(false)
    expect(suggestions.some(preset => preset.name === 'Anthropic')).toBe(true)
  })

  it('orders built-in providers by descending order weight', () => {
    const suggestions = getBuiltInProviderSuggestions([])
    const orders = suggestions.map(preset => preset.order)
    expect(orders).toEqual([...orders].sort((left, right) => right - left))
    // 权重是逐个手填的：重复值不会报错（排序会按 key 兜底），但那是漏改的痕迹。
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('gives every built-in provider an https official website', () => {
    for (const preset of getBuiltInProviderSuggestions([])) {
      expect(preset.websiteUrl).toMatch(/^https:\/\/[^/]+\.[^/]+$/)
    }
  })
})
