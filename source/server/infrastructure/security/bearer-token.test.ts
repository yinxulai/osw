import { describe, expect, it } from 'vitest'
import { constantTimeEqual, parseBearerToken } from './bearer-token'

describe('parseBearerToken', () => {
  it('parses exactly one Bearer token', () => {
    expect(parseBearerToken('Bearer secret')).toBe('secret')
    expect(parseBearerToken(undefined)).toBeNull()
    expect(parseBearerToken('Basic secret')).toBeNull()
    expect(parseBearerToken('Bearer secret extra')).toBeNull()
    expect(parseBearerToken('bearer secret')).toBeNull()
  })
})

describe('constantTimeEqual', () => {
  it('compares equal and unequal values, including different lengths', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true)
    expect(constantTimeEqual('secret', 'Secret')).toBe(false)
    expect(constantTimeEqual('secret', 'secret!')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
