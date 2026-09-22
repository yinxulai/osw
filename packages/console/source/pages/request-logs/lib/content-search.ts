/**
 * 请求详情的正文搜索。
 *
 * 搜索的目的不是把不匹配的内容藏起来，而是在整条链路上把命中处点亮并逐条定位，
 * 因此这里的产物是「高亮分段 + 有序命中列表」，而不是过滤后的正文。
 */

export interface TextMatch {
  start: number
  end: number
}

interface HighlightSegment {
  text: string
  /** 命中在全局命中序列中的序号；普通文本为 `null`。 */
  matchIndex: number | null
}

export interface SectionHighlight {
  segments: HighlightSegment[]
  count: number
}

export interface MatchLocation {
  /** 命中所在的正文块 id。 */
  sectionId: string
}

export interface ContentSearchResult {
  /** 正文块 id -> 高亮分段；没有命中的块不在表里。 */
  highlights: Map<string, SectionHighlight>
  /** 按展示顺序排列的命中，用来做「上一条 / 下一条」定位。 */
  matches: MatchLocation[]
}

export interface SearchableBlock {
  id: string
  /** 已格式化、与界面展示完全一致的正文字符串。 */
  text: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 大小写不敏感地找出全部出现位置。
 *
 * 用正则而不是 `indexOf` + `toLowerCase`：某些字符转小写后长度会变（如 `İ`），
 * 那样得到的下标会和原串错位，切分高亮时就会截错文本。
 */
function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.trim()
  if (!needle || !text) return []

  const matches: TextMatch[] = []
  for (const found of text.matchAll(new RegExp(escapeRegExp(needle), 'gi'))) {
    if (found.index === undefined || found[0].length === 0) continue
    matches.push({ start: found.index, end: found.index + found[0].length })
  }
  return matches
}

/** 把一段正文按命中切成「普通段 + 命中段」，命中段带上全局序号。 */
function splitByMatches(text: string, matches: TextMatch[], matchIndexOffset: number): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), matchIndex: null })
    segments.push({ text: text.slice(match.start, match.end), matchIndex: matchIndexOffset + index })
    cursor = match.end
  })
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchIndex: null })

  return segments
}

/**
 * 按展示顺序在多个正文块上做一次搜索。
 *
 * 命中序号全局连续，因此「第 3/12 处」可以直接映射回某个块和段内的位置。
 */
export function searchBlocks(blocks: SearchableBlock[], query: string): ContentSearchResult {
  const highlights = new Map<string, SectionHighlight>()
  const matches: MatchLocation[] = []
  if (!query.trim()) return { highlights, matches }

  blocks.forEach(block => {
    const found = findTextMatches(block.text, query)
    if (found.length === 0) return

    const segments = splitByMatches(block.text, found, matches.length)
    found.forEach(() => matches.push({ sectionId: block.id }))
    highlights.set(block.id, { segments, count: found.length })
  })

  return { highlights, matches }
}
