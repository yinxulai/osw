import { describe, expect, it } from 'vitest'
import type { RequestRewriteRule } from '../types'
import { duplicateRule, filterRules, isRuleDirty } from './rule-list'

function makeRule(overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
  return {
    id: 'rule-1',
    name: 'Add header',
    description: 'injects a header',
    enabled: true,
    global: true,
    source: 'user',
    protocols: [],
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ id: 'a-1', stage: 'request', target: 'header', operation: 'set', path: 'x-test', value: 'yes' }],
    testCases: [],
    boundProviders: 3,
    updatedTime: 1000,
    ...overrides,
  }
}

describe('isRuleDirty', () => {
  it('treats an unsaved draft (updatedTime null) as dirty', () => {
    expect(isRuleDirty(makeRule(), makeRule({ updatedTime: null }))).toBe(true)
  })

  it('is clean when the draft equals the saved rule', () => {
    const saved = makeRule()
    expect(isRuleDirty(saved, makeRule())).toBe(false)
  })

  it('is dirty when any field diverges from the saved rule', () => {
    expect(isRuleDirty(makeRule(), makeRule({ name: 'Renamed' }))).toBe(true)
  })

  it('is clean when there is no saved rule but the draft was already persisted', () => {
    expect(isRuleDirty(undefined, makeRule())).toBe(false)
  })
})

describe('filterRules', () => {
  const rules = [
    makeRule({ id: 'r1', name: 'Alpha', enabled: true }),
    makeRule({ id: 'r2', name: 'Beta', enabled: false, description: 'disabled one' }),
    makeRule({ id: 'r3', name: 'Gamma', enabled: true, actions: [{ id: 'a', stage: 'request', target: 'body', operation: 'set', path: 'model', value: 'claude' }] }),
  ]

  it('returns everything for the default filter', () => {
    expect(filterRules(rules, '', 'all')).toHaveLength(3)
  })

  it('filters by enabled status', () => {
    expect(filterRules(rules, '', 'enabled').map(r => r.id)).toEqual(['r1', 'r3'])
    expect(filterRules(rules, '', 'disabled').map(r => r.id)).toEqual(['r2'])
  })

  it('matches the keyword against name, description and action fields case-insensitively', () => {
    expect(filterRules(rules, 'beta', 'all').map(r => r.id)).toEqual(['r2'])
    expect(filterRules(rules, 'CLAUDE', 'all').map(r => r.id)).toEqual(['r3'])
    expect(filterRules(rules, 'nope', 'all')).toHaveLength(0)
  })

  it('combines status and keyword', () => {
    expect(filterRules(rules, 'a', 'enabled').map(r => r.id)).toEqual(['r1', 'r3'])
  })
})

describe('duplicateRule', () => {
  it('reseeds ids, drops saved markers and renames', () => {
    const source = makeRule({
      actions: [{ id: 'a-old', stage: 'request', target: 'header', operation: 'set', path: 'x', value: '1' }],
      testCases: [{ id: 't-old', name: 'case', stage: 'request', body: '', headers: '', clientProtocol: 'openai' as never, upstreamProtocol: 'openai' as never, transport: 'buffered' as never }],
    })
    const copy = duplicateRule(source, { name: 'Add header (copy)', now: 42 })

    expect(copy.id).toBe('rule-42')
    expect(copy.name).toBe('Add header (copy)')
    expect(copy.global).toBe(false)
    expect(copy.boundProviders).toBe(0)
    expect(copy.updatedTime).toBeNull()
    expect(copy.actions[0].id).toBe('action-42-0')
    expect(copy.testCases[0].id).toBe('test-42-0')
    // 原规则不受影响。
    expect(source.actions[0].id).toBe('a-old')
  })
})
