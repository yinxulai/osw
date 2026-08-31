import { describe, expect, it } from 'vitest'
import { isFreeModel, openRouterFreeSource } from './openrouter'

describe('openRouterFreeSource', () => {
  it('declares the expected metadata', () => {
    expect(openRouterFreeSource.key).toBe('openrouter-free')
    expect(openRouterFreeSource.presetKey).toBe('openrouter')
    expect(openRouterFreeSource.requiresApiKey).toBe(false)
    expect(openRouterFreeSource.endpoints['openai-completions']).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(typeof openRouterFreeSource.fetchFreeModels).toBe('function')
  })
})

describe('isFreeModel', () => {
  it('treats numeric zero pricing as free', () => {
    expect(isFreeModel({ id: 'a', pricing: { prompt: 0, completion: 0 } })).toBe(true)
  })

  it('treats numeric-string zero pricing as free', () => {
    expect(isFreeModel({ id: 'a', pricing: { prompt: '0', completion: '0.000000' } })).toBe(true)
  })

  it('treats any positive price as not free', () => {
    expect(isFreeModel({ id: 'a', pricing: { prompt: '0.000001', completion: '0' } })).toBe(false)
    expect(isFreeModel({ id: 'a', pricing: { prompt: 0, completion: 0.001 } })).toBe(false)
  })

  it('treats missing pricing as not free', () => {
    expect(isFreeModel({ id: 'a' })).toBe(false)
    expect(isFreeModel({ id: 'a', pricing: {} })).toBe(false)
    expect(isFreeModel({ id: 'a', pricing: { prompt: 0 } })).toBe(false)
  })

  it('treats unparsable pricing as not free', () => {
    expect(isFreeModel({ id: 'a', pricing: { prompt: 'free', completion: 'free' } })).toBe(false)
  })
})
