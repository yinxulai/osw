import { describe, expect, it } from 'vitest'
import { buildModelListUrls, parseModelListResponse } from './routes/diagnostics/provider-models-fetch'

describe('buildModelListUrls', () => {
  it('builds /models and /v1/models variants for a bare base url', () => {
    expect(buildModelListUrls('https://api.example.com')).toEqual([
      'https://api.example.com/models',
      'https://api.example.com/v1/models',
    ])
  })

  it('keeps existing version segment without duplicating v1', () => {
    expect(buildModelListUrls('https://api.example.com/v1')).toEqual([
      'https://api.example.com/v1/models',
    ])
  })

  it('strips trailing resource segments like chat/completions', () => {
    expect(buildModelListUrls('https://api.example.com/v1/chat/completions')).toEqual([
      'https://api.example.com/v1/models',
    ])
  })

  it('preserves custom base paths', () => {
    expect(buildModelListUrls('https://gateway.example.com/openai/v1/')).toEqual([
      'https://gateway.example.com/openai/v1/models',
    ])
  })

  it('returns empty for invalid urls', () => {
    expect(buildModelListUrls('not-a-url')).toEqual([])
    expect(buildModelListUrls('ftp://example.com')).toEqual([])
  })
})

describe('parseModelListResponse', () => {
  it('parses openai style responses', () => {
    const models = parseModelListResponse(JSON.stringify({
      data: [
        { id: 'gpt-4o', object: 'model', owned_by: 'openai', created: 1715367049 },
      ],
    }))
    expect(models).toEqual([
      { id: 'gpt-4o', ownedBy: 'openai', displayName: null, createdTime: 1715367049 },
    ])
  })

  it('parses anthropic style responses', () => {
    const models = parseModelListResponse(JSON.stringify({
      data: [
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet (New)', created_at: '2024-10-22T00:00:00Z' },
      ],
    }))
    expect(models).not.toBeNull()
    expect(models![0].id).toBe('claude-3-5-sonnet-20241022')
    expect(models![0].displayName).toBe('Claude 3.5 Sonnet (New)')
    expect(models![0].createdTime).toBe(Math.floor(new Date('2024-10-22T00:00:00Z').getTime() / 1000))
  })

  it('skips entries without a valid id', () => {
    const models = parseModelListResponse(JSON.stringify({ data: [{ id: '' }, { id: 42 }, null, { id: 'ok' }] }))
    expect(models).toEqual([{ id: 'ok', ownedBy: null, displayName: null, createdTime: null }])
  })

  it('returns null for non-json or non-list bodies', () => {
    expect(parseModelListResponse('not json')).toBeNull()
    expect(parseModelListResponse('{}')).toBeNull()
    expect(parseModelListResponse('[]')).toBeNull()
  })
})
