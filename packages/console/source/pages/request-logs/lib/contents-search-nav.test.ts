import { describe, expect, it } from 'vitest'
import type { ContentStage } from './contents'
import { collectMatchedStageIds, cycleMatchIndex, fullOpenTable, openEntries } from './contents-search-nav'

const stage = (id: string, sectionIds: string[]): ContentStage => ({
  id,
  title: id,
  sections: sectionIds.map(sid => ({ id: sid, title: sid, value: null })),
} as unknown as ContentStage)

describe('cycleMatchIndex', () => {
  it('wraps forward and backward', () => {
    expect(cycleMatchIndex(0, 1, 3)).toBe(1)
    expect(cycleMatchIndex(2, 1, 3)).toBe(0)
    expect(cycleMatchIndex(0, -1, 3)).toBe(2)
  })

  it('stays at 0 with no matches', () => {
    expect(cycleMatchIndex(0, 1, 0)).toBe(0)
  })
})

describe('collectMatchedStageIds', () => {
  const stages = [stage('s1', ['a', 'b']), stage('s2', ['c']), stage('s3', ['d'])]

  it('maps matched sections back to their stages', () => {
    expect([...collectMatchedStageIds(stages, new Set(['b', 'd']))].sort()).toEqual(['s1', 's3'])
  })

  it('is empty when nothing matches', () => {
    expect(collectMatchedStageIds(stages, new Set(['zzz'])).size).toBe(0)
  })
})

describe('openEntries', () => {
  it('adds missing ids as open and returns a new object', () => {
    const current = { a: false }
    const next = openEntries(current, ['a', 'b'])
    expect(next).toEqual({ a: true, b: true })
    expect(next).not.toBe(current)
  })

  it('returns the same reference when nothing changes', () => {
    const current = { a: true, b: true }
    expect(openEntries(current, ['a', 'b'])).toBe(current)
  })
})

describe('fullOpenTable', () => {
  it('sets every id to the same value', () => {
    expect(fullOpenTable(['a', 'b'], true)).toEqual({ a: true, b: true })
    expect(fullOpenTable(['a', 'b'], false)).toEqual({ a: false, b: false })
  })
})
