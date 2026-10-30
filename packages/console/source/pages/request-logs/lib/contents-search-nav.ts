import type { ContentStage } from './contents'

/** 开合表：阶段 / 分节 id → 是否展开。 */
export type OpenTable = Record<string, boolean>

/** 环形推进命中光标；`total` 为 0 时回到 0。 */
export function cycleMatchIndex(current: number, delta: number, total: number): number {
  if (total === 0) return 0
  return (current + delta + total) % total
}

/** 命中所在的分节 id 集合 → 包含这些分节的阶段 id 集合。 */
export function collectMatchedStageIds(stages: readonly ContentStage[], matchedSectionIds: ReadonlySet<string>): Set<string> {
  return new Set(
    stages
      .filter(stage => stage.sections.some(section => matchedSectionIds.has(section.id)))
      .map(stage => stage.id),
  )
}

/**
 * 把一批 id 并入开合表——**只开不关**，且没有实际变化时返回原引用。
 *
 * 引用稳定很关键：命中高亮的 effect 会反复算这张表，每次都返回新对象会被 React 当成
 * 「值一直在变」而空转重渲染。
 */
export function openEntries(current: OpenTable, ids: Iterable<string>): OpenTable {
  let changed = false
  const next = { ...current }
  for (const id of ids) {
    if (!next[id]) {
      next[id] = true
      changed = true
    }
  }
  return changed ? next : current
}

/** 把一批 id 一次性置成同一开合值（「全部展开 / 全部收起」用）。 */
export function fullOpenTable(ids: readonly string[], open: boolean): OpenTable {
  return Object.fromEntries(ids.map(id => [id, open]))
}
