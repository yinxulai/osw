import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/i18n/provider'
import { searchBlocks } from '../lib/content-search'
import { formatContent } from '../lib/format-content'
import type { ContentStage } from '../lib/contents'
import { collectMatchedStageIds, cycleMatchIndex, fullOpenTable, openEntries, type OpenTable } from '../lib/contents-search-nav'

/**
 * 搜索条压在滚动区顶部（`sticky top-0`），定位时必须给它让出这条高度，
 * 否则「居中」的命中会正好落在它下面。
 */
const TOOLBAR_RESERVE_PX = 56

interface UseContentsSearchInput {
  /** 当前选中的尝试；切换它就把搜索与展开态清空。 */
  selectedAttemptId: string | null
  stages: ContentStage[]
}

/**
 * 正文面板的「搜索命中导航 + 展开/收起」状态机的**绑定层**。
 *
 * 纯算法（命中光标环形推进、命中分节→阶段、开合表合并）都在 `../lib/contents-search-nav`，
 * 可脱离 React 单测；这里只负责把它们接到 react state、三个副作用与滚动定位上，
 * 并顺手把「搜索什么、命中了几条」算好交给组件渲染。
 */
export function useContentsSearch(input: UseContentsSearchInput) {
  const { selectedAttemptId, stages } = input
  const t = useTranslation()
  const [search, setSearch] = useState('')
  const [stageStates, setStageStates] = useState<OpenTable>({})
  const [sectionStates, setSectionStates] = useState<OpenTable>({})
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  // 每次「上一条 / 下一条」都自增：命中序号可能没变（只有一条命中、或首尾环形回到自己），
  // 那时光靠 `activeMatchIndex` 不会触发定位，用户就会觉得按钮点了没反应。
  const [jumpToken, setJumpToken] = useState(0)
  const contentRef = useRef<HTMLDivElement | null>(null)
  // 「上一条 / 下一条」必须以**最新**的命中序号为基准：连点两下时两次点击都发生在
  // 同一帧之前，闭包里读到的会是同一个旧下标，于是两次都算出了同一个 `next`。
  // 把序号同时镜像进 ref，点击时读 ref 就不会丢帧。
  const activeMatchRef = useRef(0)

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

  // 换一个搜索词就回到第一条命中。只挂在词上，**不挂 `searchResult`**：
  // 请求还在跑时正文每 1.5s 刷新一次，`searchResult` 跟着换了引用，
  // 若把「回到第一条」绑在它上面，光标就会在用户翻页时被反复拽回开头。
  useEffect(() => {
    setActiveMatchIndex(0)
    activeMatchRef.current = 0
    // 命中条数不变时（3 条 → 3 条）序号也没变，不复位令牌就不会重新定位，
    // 用户看到的是「换了词但画面没动」。
    setJumpToken(current => current + 1)
  }, [search])

  // 有命中的块要自动展开，否则高亮藏在折叠标题底下，翻页翻得再准也看不见。
  // `openEntries` 在没有变化时返回原引用，因此正文轮询重复触发这里不会造成重渲染。
  useEffect(() => {
    const matchedIds = new Set(searchResult.matches.map(match => match.sectionId))
    if (matchedIds.size === 0) return
    const matchedStageIds = collectMatchedStageIds(stages, matchedIds)
    setStageStates(current => openEntries(current, matchedStageIds))
    setSectionStates(current => openEntries(current, matchedIds))
  }, [searchResult, stages])

  // 定位只在「换了一条命中」「点了上/下一条」「命中所在的块刚被展开」时发生。
  //
  // 依赖里带开合表是必须的：输入搜索词那一次渲染里目标块还折叠着，`<mark>` 压根没挂上，
  // 只有等「展开有命中的块」那次提交之后才查得到。`openEntries` 在没有变化时返回原引用，
  // 所以正文轮询（请求还在跑时每 1.5s 一次）不会让这里反复触发、把滚动条拽回命中处。
  useLayoutEffect(() => {
    const container = contentRef.current
    if (container === null || totalMatches === 0) return
    const target = container.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
    if (target === null) return

    // 只滚自己的 `scrollTop`：`scrollIntoView` 会把每一层可滚动祖先（含整页）都滚一遍，
    // 在这个铺满视口的 Sheet 里就表现为「点下一条整页跟着抖」。
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const offsetWithinContent = targetRect.top - containerRect.top + container.scrollTop
    const centered = offsetWithinContent - (container.clientHeight - TOOLBAR_RESERVE_PX - targetRect.height) / 2
    // 不用平滑滚动：阶段/分节刚被展开时高度还在变，平滑动画会在中途被布局变化打断，
    // 最后停的位置跟「居中的那一条」对不上。
    container.scrollTop = Math.max(0, centered)
  }, [activeMatchIndex, jumpToken, totalMatches, sectionStates, stageStates])

  // 光标每次落定都同步进 ref（`jumpToMatch` 里已经写过一次，这里是兜底：
  // 「换搜索词回到第一条」这类不经过 `jumpToMatch` 的复位也要让 ref 跟上）。
  useEffect(() => {
    activeMatchRef.current = activeMatchIndex
  }, [activeMatchIndex])

  const jumpToMatch = (delta: number) => {
    if (totalMatches === 0) return
    const next = cycleMatchIndex(activeMatchRef.current, delta, totalMatches)
    activeMatchRef.current = next
    const sectionId = searchResult.matches[next]?.sectionId
    // 手动折叠过的块，定位到它时要先展开。
    if (sectionId) {
      const stageId = stages.find(stage => stage.sections.some(section => section.id === sectionId))?.id
      if (stageId) setStageStates(current => openEntries(current, [stageId]))
      setSectionStates(current => openEntries(current, [sectionId]))
    }
    setActiveMatchIndex(next)
    setJumpToken(current => current + 1)
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
