import { describe, expect, it } from 'vitest'
import { searchBlocks } from './content-search'

/**
 * 只看一个块时，高亮分段就是把命中切开并按序编号本身。
 * 切分与查找都是这个入口的内部实现，因此它们不单独导出，也就只能这样验。
 */
function segmentsOf(text: string, query: string) {
  return searchBlocks([{ id: 'a', text }], query).highlights.get('a')?.segments ?? []
}

describe('searchBlocks', () => {
  it('finds every occurrence case-insensitively', () => {
    expect(segmentsOf('Tool, tool, TOOL', 'tool')).toEqual([
      { text: 'Tool', matchIndex: 0 },
      { text: ', ', matchIndex: null },
      { text: 'tool', matchIndex: 1 },
      { text: ', ', matchIndex: null },
      { text: 'TOOL', matchIndex: 2 },
    ])
  })

  it('ignores empty queries and blocks', () => {
    expect(searchBlocks([{ id: 'a', text: 'content' }], '   ').highlights.size).toBe(0)
    expect(segmentsOf('', 'content')).toEqual([])
  })

  it('treats the query as literal text rather than a pattern', () => {
    expect(segmentsOf('a.c abc', 'a.c')).toEqual([
      { text: 'a.c', matchIndex: 0 },
      { text: ' abc', matchIndex: null },
    ])
  })

  it('numbers matches continuously across the whole chain', () => {
    const result = searchBlocks([
      { id: 'a', text: 'aXbXc' },
      { id: 'b', text: 'X' },
    ], 'x')

    expect(result.highlights.get('a')?.segments).toEqual([
      { text: 'a', matchIndex: null },
      { text: 'X', matchIndex: 0 },
      { text: 'b', matchIndex: null },
      { text: 'X', matchIndex: 1 },
      { text: 'c', matchIndex: null },
    ])
    expect(result.highlights.get('b')?.segments).toEqual([{ text: 'X', matchIndex: 2 }])
    expect(result.matches).toEqual([{ sectionId: 'a' }, { sectionId: 'a' }, { sectionId: 'b' }])
  })
  it('orders matches by block and keeps them across the whole chain', () => {
    const result = searchBlocks(
      [
        { id: 'a', text: 'model=gpt-4' },
        { id: 'b', text: 'nothing here' },
        { id: 'c', text: 'model=gpt-4o' },
      ],
      'model',
    )

    expect(result.matches).toEqual([
      { sectionId: 'a' },
      { sectionId: 'c' },
    ])
    expect(result.highlights.get('a')?.count).toBe(1)
    expect(result.highlights.has('b')).toBe(false)
    expect(result.highlights.get('c')?.segments).toEqual([
      { text: 'model', matchIndex: 1 },
      { text: '=gpt-4o', matchIndex: null },
    ])
  })

  it('returns nothing for an empty query', () => {
    const result = searchBlocks([{ id: 'a', text: 'model' }], '  ')

    expect(result.matches).toEqual([])
    expect(result.highlights.size).toBe(0)
    expect(segmentsOf('', 'model')).toEqual([])
  })
})
