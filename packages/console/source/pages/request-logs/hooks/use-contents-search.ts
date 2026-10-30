import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/i18n/provider'
import { searchBlocks } from '../lib/content-search'
import { formatContent } from '../lib/format-content'
import type { ContentStage } from '../lib/contents'
import { collectMatchedStageIds, cycleMatchIndex, fullOpenTable, openEntries, type OpenTable } from '../lib/contents-search-nav'

interface UseContentsSearchInput {
  /** 当前选中的尝试；切换它就把搜索与展开态清空。 */
  selectedAttemptId: string | null
  stages: ContentStage[]
}

/**
 * 正文面板的「搜索命中导航 + 展开/收起」状态机的**绑定层**。
 *
 * 纯算法（命中光标环形推进、命中分节→阶段、开合表合并）都在 `../lib/contents-search-nav`，
 * 可脱离 React 单测；这里只负责把它们接到 react state、三个副作用与 `scrollIntoView` 上，
 * 并顺手把「搜索什么、命中了几条」算好交给组件渲染。
 */
export function useContentsSearch(input: UseContentsSearchInput) {
  const { selectedAttemptId, stages } = input
  const t = useTranslation()
  const [search, setSearch] = useState('')
  const [stageStates, setStageStates] = useState<OpenTable>({})
  const [sectionStates, setSectionStates] = useState<OpenTable>({})
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const sections = useMemo(
    () => stages.flatMap(stage => stage.sections).filter(section => section.value !== null),
    [stages],
  )

  // 搜索的是「界面上真正展示的那段文本」，而 JSON 展开、流式拼回都会改变正文，
  // 所以先过一遍 formatContent，确保高亮位置和渲染出来的字符一一对应。
  const searchResult = useMemo(
    () => searchBlocks(sections.map(section => ({ id: section.id, text: formatContent(t, section.value!).value })), search),
    [t, sections, search],
  )
  const totalMatches = searchResult.matches.length
  const searchQuery = search.trim()

  // 切换 attempt 就清空搜索与展开态。setter 先比对再写：写 `{}` 这种新对象即使内容一样
  // 也会被判定为新 state，白白多一轮重渲染。
  useEffect(() => {
    setSearch(current => (current === '' ? current : ''))
    setStageStates(current => (Object.keys(current).length === 0 ? current : {}))
    setSectionStates(current => (Object.keys(current).length === 0 ? current : {}))
  }, [selectedAttemptId])

  // 换一个搜索词就回到第一条命中，并把有命中的块展开；否则高亮会藏在折叠标题底下。
  useEffect(() => {
    setActiveMatchIndex(current => (current === 0 ? current : 0))
    const matchedIds = new Set(searchResult.matches.map(match => match.sectionId))
    if (matchedIds.size === 0) return
    const matchedStageIds = collectMatchedStageIds(stages, matchedIds)
    setStageStates(current => openEntries(current, matchedStageIds))
    setSectionStates(current => openEntries(current, matchedIds))
  }, [searchResult, stages])

  // 命中所在的块可能刚刚被展开才挂到 DOM 上，因此 sectionStates 变化也要重新定位。
  useEffect(() => {
    if (totalMatches === 0) return
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [activeMatchIndex, totalMatches, sectionStates, stageStates])

  const jumpToMatch = (delta: number) => {
    if (totalMatches === 0) return
    const next = cycleMatchIndex(activeMatchIndex, delta, totalMatches)
    const sectionId = searchResult.matches[next]?.sectionId
    // 手动折叠过的块，定位到它时要先展开。
    if (sectionId) {
      const stageId = stages.find(stage => stage.sections.some(section => section.id === sectionId))?.id
      if (stageId) setStageStates(current => openEntries(current, [stageId]))
      setSectionStates(current => openEntries(current, [sectionId]))
    }
    setActiveMatchIndex(next)
  }

  // 展开/折叠覆盖阶段与分节；正文没到时也保留同一批稳定 id，按钮不会因加载而失效。
  const visibleStageIds = useMemo(() => stages.map(stage => stage.id), [stages])
  const visibleSectionIds = useMemo(() => stages.flatMap(stage => stage.sections).map(section => section.id), [stages])
  const expandable = visibleStageIds.length > 0

  const expandAll = () => {
    setStageStates(fullOpenTable(visibleStageIds, true))
    setSectionStates(fullOpenTable(visibleSectionIds, true))
  }
  const collapseAll = () => {
    setStageStates(fullOpenTable(visibleStageIds, false))
    setSectionStates(fullOpenTable(visibleSectionIds, false))
  }

  const setStageOpen = (id: string, open: boolean) => setStageStates(current => ({ ...current, [id]: open }))
  const setSectionOpen = (id: string, open: boolean) => setSectionStates(current => ({ ...current, [id]: open }))

  return {
    search,
    setSearch,
    searchQuery,
    searchResult,
    totalMatches,
    sections,
    stageStates,
    sectionStates,
    activeMatchIndex,
    contentRef,
    jumpToMatch,
    expandable,
    expandAll,
    collapseAll,
    setStageOpen,
    setSectionOpen,
  }
}
