import { describe, expect, it } from 'vitest'
import { findPresetByName, getBuiltInProviderSuggestions } from './provider-presets'

describe('provider presets', () => {
  it('finds known aliases for built-in providers', () => {
    const preset = findPresetByName('gpt')
    expect(preset?.name).toBe('OpenAI')
  })

  it('shows missing built-in providers as suggestions before users create them', () => {
    const suggestions = getBuiltInProviderSuggestions(['OpenAI'])
    expect(suggestions.some(preset => preset.name === 'OpenAI')).toBe(false)
    expect(suggestions.some(preset => preset.name === 'Anthropic')).toBe(true)
  })
})
