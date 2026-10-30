import { describe, expect, it } from 'vitest'
import { REWRITE_SCRIPT_TIMEOUT_DEFAULT, REWRITE_SCRIPT_TIMEOUT_LIMIT } from '@common/schemas'
import { normalizeScriptTimeout } from './script-timeout'

describe('normalizeScriptTimeout', () => {
  it('keeps a valid value, rounded', () => {
    expect(normalizeScriptTimeout('1500')).toBe(1500)
    expect(normalizeScriptTimeout('1500.6')).toBe(1501)
  })

  it('falls back to the default for non-numbers, zero and negatives', () => {
    expect(normalizeScriptTimeout('')).toBe(REWRITE_SCRIPT_TIMEOUT_DEFAULT)
    expect(normalizeScriptTimeout('abc')).toBe(REWRITE_SCRIPT_TIMEOUT_DEFAULT)
    expect(normalizeScriptTimeout('0')).toBe(REWRITE_SCRIPT_TIMEOUT_DEFAULT)
    expect(normalizeScriptTimeout('-50')).toBe(REWRITE_SCRIPT_TIMEOUT_DEFAULT)
  })

  it('clamps above the limit', () => {
    expect(normalizeScriptTimeout(String(REWRITE_SCRIPT_TIMEOUT_LIMIT + 10_000))).toBe(REWRITE_SCRIPT_TIMEOUT_LIMIT)
  })
})
