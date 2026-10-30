import { describe, expect, it } from 'vitest'
import { createDefaultRouteRuleSet, createRouteRule, type RouteRuleSet } from '@common/router/route-rules'
import {
  appendRule,
  duplicateRuleInSet,
  patchRuleInSet,
  removeRuleFromSet,
  reorderRules,
  toggleFallbackModelInSet,
} from './rule-ops'

function emptySet(): RouteRuleSet {
  return { ...createDefaultRouteRuleSet([]), rules: [], fallbackModelIds: [] }
}

function setOf(count: number): RouteRuleSet {
  let set = emptySet()
  for (let i = 0; i < count; i += 1) set = appendRule(set, createRouteRule())
  return set
}

describe('appendRule', () => {
  it('adds the rule to the end', () => {
    const base = emptySet()
    const rule = createRouteRule()
    const next = appendRule(base, rule)
    expect(next.rules.at(-1)).toBe(rule)
    expect(next.rules.length).toBe(base.rules.length + 1)
  })
})

describe('patchRuleInSet', () => {
  it('patches only the targeted rule', () => {
    const set = setOf(2)
    const id = set.rules[0].id
    const next = patchRuleInSet(set, id, { enabled: false })
    expect(next.rules[0].enabled).toBe(false)
    expect(next.rules[1]).toBe(set.rules[1])
  })
})

describe('duplicateRuleInSet', () => {
  it('inserts a deep-ish copy right after the source with a new id', () => {
    const set = setOf(2)
    const source = set.rules[0]
    const next = duplicateRuleInSet(set, source.id)
    expect(next.rules.length).toBe(3)
    const copy = next.rules[1]
    expect(copy.id).not.toBe(source.id)
    expect(copy.conditions).not.toBe(source.conditions)
    expect(copy.landing.logicalModelIds).not.toBe(source.landing.logicalModelIds)
  })

  it('returns the same set when the id is unknown', () => {
    const set = setOf(1)
    expect(duplicateRuleInSet(set, 'nope')).toBe(set)
  })
})

describe('reorderRules', () => {
  it('moves the active rule to the over position', () => {
    const set = setOf(3)
    const [a, b, c] = set.rules
    const next = reorderRules(set, a.id, c.id)
    expect(next.rules.map(r => r.id)).toEqual([b.id, c.id, a.id])
  })

  it('returns the same set when an id is missing', () => {
    const set = setOf(2)
    expect(reorderRules(set, set.rules[0].id, 'nope')).toBe(set)
  })
})

describe('toggleFallbackModelInSet', () => {
  it('appends on check (deduped) and removes on uncheck', () => {
    const base = emptySet()
    const withOne = toggleFallbackModelInSet(base, 'm1', true)
    expect(withOne.fallbackModelIds).toContain('m1')
    const deduped = toggleFallbackModelInSet(withOne, 'm1', true)
    expect(deduped.fallbackModelIds.filter(id => id === 'm1')).toHaveLength(1)
    const removed = toggleFallbackModelInSet(deduped, 'm1', false)
    expect(removed.fallbackModelIds).not.toContain('m1')
  })
})

describe('removeRuleFromSet', () => {
  it('drops the targeted rule', () => {
    const set = setOf(2)
    const id = set.rules[0].id
    const next = removeRuleFromSet(set, id)
    expect(next.rules.map(r => r.id)).toEqual([set.rules[1].id])
  })
})

