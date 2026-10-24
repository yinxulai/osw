import * as React from 'react'
import type { AppliedRequestRewriteRule, AttemptContent, AttemptContentSummary, RequestContent, RequestContentSummary, RequestLogEntryAttempt } from '@common/schemas'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useTranslation } from '@/i18n/provider'
import { useRequestLogBodiesQuery } from '../queries'
import { searchBlocks } from '../lib/content-search'
import { buildContentStages, type ContentStage } from '../lib/contents'
import { formatContent } from '../lib/format-content'
import { RequestContentsBody } from './request-contents-body'
import { RequestContentsHeader } from './request-contents-header'
import { RequestContentsToolbar } from './request-contents-toolbar'

interface RequestContentsSheetProps {
  /** 客户端视角正文摘要；每个请求至多一行。只有报文身份，没有正文。 */
  contents: RequestContentSummary[] | null
  /** 上游视角正文摘要；每次尝试至多一行。只有报文身份，没有正文。 */
  attemptContents: AttemptContentSummary[] | null
  /** 请求 ID。正文由面板自己按需取（见 `useRequestLogBodiesQuery`）。 */
  requestId: string
  /**
   * 请求还在进行中（`pending`）时把正文保持在新鲜状态；一旦落定就停：
   * 那时正文已经写完，再取只是重复解压同一份数据。
   */
  pollBodies: boolean
  attempts: RequestLogEntryAttempt[]
  requestRewriteRules: AppliedRequestRewriteRule[] | null
  /** 客户端协议；`null` 表示该请求连 API 路径都未识别。 */
  clientProtocol: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  /**
   * 真正把响应写回客户端的那次尝试；`null` 表示这次请求没有任何尝试。
   *
   * 客户端跳在整条请求上只有一条出口，而且**最多只写一次**：它只属于
   * `servingAttemptOf(log)`（尝试顺序里的最后一条）。这条事实必须由外面传进来，
   * 面板自己只能看到「选中了哪次尝试」，猜不出谁交付过。
   */
  servingAttemptId: string | null
  onClose: () => void
}

export function RequestContentsSheet(props: RequestContentsSheetProps) {
  const t = useTranslation()
  const selectedAttempt = props.attempts.find(attempt => attempt.id === props.selectedAttemptId) ?? null
  // 正文由面板自己取：它是库里最大的那几列，只在「用户真的点开某个尝试」这一刻才请求一次
  // （`selectedAttemptId` 为空时查询整个禁用）。加载态因此也只落在面板内部，不拖累宿主。
  const bodiesQuery = useRequestLogBodiesQuery(props.selectedAttemptId === null ? null : props.requestId, props.pollBodies)
  const bodies = bodiesQuery.data ?? null
  // 详情本身还没到（摘要、改写规则在路上）与正文在路上，对用户是同一件事：这一块还没内容。
  // 两种来源合并成一个 `loading`，画面就只会有「骨架 → 内容」这一条路径。
  const contentsLoading = props.selectedAttemptId !== null && (props.loading || bodiesQuery.isPending)
  const bodiesError = bodiesQuery.error === null ? null : bodiesQuery.error.message
  // 摘要在详情里（随行一起到达），正文在 `bodies` 里（点开面板才取），两者按 `id`
  // 对齐后才是渲染需要的一整行。对齐失败只可能是「正文还没取到」，落 `null`；
  // 那时正文区块画的是骨架，不会把「还没取」画成「没采到」。
  const attemptSummary = props.attemptContents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const attemptBody = bodies?.attemptContents.find(content => content.id === attemptSummary?.id) ?? null
  const attemptContent: AttemptContent | null = attemptSummary === null ? null : {
    ...attemptSummary,
    requestBody: attemptBody?.requestBody ?? null,
    responseBody: attemptBody?.responseBody ?? null,
  }
  // 客户端视角每个请求只有一行，不需要按 attemptId 筛选。
  const clientSummary = props.contents?.[0] ?? null
  const clientBody = bodies?.contents.find(content => content.id === clientSummary?.id) ?? null
  const clientContent: RequestContent | null = clientSummary === null ? null : {
    ...clientSummary,
    requestBody: clientBody?.requestBody ?? null,
    responseBody: clientBody?.responseBody ?? null,
  }
  const [search, setSearch] = React.useState('')
  const [stageStates, setStageStates] = React.useState<Record<string, boolean>>({})
  const [sectionStates, setSectionStates] = React.useState<Record<string, boolean>>({})
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // 「发生过协议转换」不是独立事实：客户端协议与本次尝试的上游协议不同即为转换。
  const clientProtocol = props.clientProtocol
  const upstreamProtocol = selectedAttempt?.upstreamProtocol ?? null
  const converted = clientProtocol !== null && upstreamProtocol !== null && clientProtocol !== upstreamProtocol
  // 客户端跳只写一次，而且只可能由服务该请求的那次尝试写出，因此这里只做身份比对。
  const servesClient = props.selectedAttemptId !== null && props.selectedAttemptId === props.servingAttemptId

  const stages = React.useMemo<ContentStage[]>(() => buildContentStages(t, {
    clientContent,
    attemptContent,
    clientProtocol,
    upstreamProtocol,
    converted,
    servesClient,
  }), [t, clientContent, attemptContent, clientProtocol, upstreamProtocol, converted, servesClient])

  const appliedRules = React.useMemo(() => {
    if (selectedAttempt === null) return []
    const namesById = new Map(props.requestRewriteRules?.map(rule => [rule.id, rule.name]) ?? [])
    return [...new Set([
      ...selectedAttempt.requestRewriteRuleIds,
      ...selectedAttempt.responseRewriteRuleIds,
    ])].map(id => ({ key: id, name: namesById.get(id) ?? id }))
  }, [props.requestRewriteRules, selectedAttempt])

  const sections = React.useMemo(
    () => stages.flatMap(stage => stage.sections).filter(section => section.value !== null),
    [stages],
  )

  // 搜索的是「界面上真正展示的那段文本」，而 JSON 展开、流式拼回都会改变正文，
  // 所以先过一遍 formatContent，确保高亮位置和渲染出来的字符一一对应。
  const searchResult = React.useMemo(
    () => searchBlocks(sections.map(section => ({ id: section.id, text: formatContent(t, section.value!).value })), search),
    [t, sections, search],
  )
  const totalMatches = searchResult.matches.length
  const searchQuery = search.trim()

  React.useEffect(() => {
    // 切换 attempt 就清空搜索与展开态。两个 setter 都先比对再写：
    // 写 `{}` 这种新对象即使内容一样也会被判定为新 state，白白多一轮重渲染。
    setSearch(current => (current === '' ? current : ''))
    setStageStates(current => (Object.keys(current).length === 0 ? current : {}))
    setSectionStates(current => (Object.keys(current).length === 0 ? current : {}))
  }, [props.selectedAttemptId])

  // 换一个搜索词就回到第一条命中，并把有命中的块展开；
  // 否则高亮会藏在折叠标题底下，而用户看不到任何反应。
  React.useEffect(() => {
    setActiveMatchIndex(current => (current === 0 ? current : 0))
    const matchedIds = new Set(searchResult.matches.map(match => match.sectionId))
    if (matchedIds.size === 0) return
    const matchedStageIds = new Set(stages
      .filter(stage => stage.sections.some(section => matchedIds.has(section.id)))
      .map(stage => stage.id))
    setStageStates(current => {
      let changed = false
      const next = { ...current }
      matchedStageIds.forEach(id => {
        if (!next[id]) {
          next[id] = true
          changed = true
        }
      })
      return changed ? next : current
    })
    setSectionStates(current => {
      let changed = false
      const next = { ...current }
      matchedIds.forEach(id => {
        if (!next[id]) {
          next[id] = true
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [searchResult, stages])

  // 命中所在的块可能刚刚被展开才挂到 DOM 上，因此 sectionStates 变化也要重新定位。
  React.useEffect(() => {
    if (totalMatches === 0) return
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [activeMatchIndex, totalMatches, sectionStates, stageStates])

  const jumpToMatch = (delta: number) => {
    if (totalMatches === 0) return
    const next = (activeMatchIndex + delta + totalMatches) % totalMatches
    const sectionId = searchResult.matches[next]?.sectionId
    // 手动折叠过的块，定位到它时要先展开。
    if (sectionId) {
      const stageId = stages.find(stage => stage.sections.some(section => section.id === sectionId))?.id
      if (stageId) setStageStates(current => (current[stageId] ? current : { ...current, [stageId]: true }))
      setSectionStates(current => (current[sectionId] ? current : { ...current, [sectionId]: true }))
    }
    setActiveMatchIndex(next)
  }

  // 展开/折叠覆盖阶段与分节；正文没到时也保留同一批稳定 id，按钮不会因加载而失效。
  const visibleStageIds = stages.map(stage => stage.id)
  const visibleSectionIds = stages.flatMap(stage => stage.sections).map(section => section.id)
  // 一条正文都没有：被保留策略清掉了，或采集正文的开关一直是关的。
  // 这两种情况在数据上无法区分（都是「没有行」），因此只说事实、不猜原因。
  // 加载中（还可能取到）、取正文失败（取不到）、详情失败（压根不知道有没有）都不是「没有」，
  // 不能混进这条结论。
  const bodiesMissing = props.error === null && !contentsLoading && bodiesError === null && sections.length === 0
  const expandable = visibleStageIds.length > 0
  // 「全部展开 / 收起」直接写这批 id 的布尔表。一条正文都没有时按钮是禁用的（见 `expandable`），
  // 因此这里不需要考虑空表。
  const expandAll = () => {
    setStageStates(Object.fromEntries(visibleStageIds.map(id => [id, true])))
    setSectionStates(Object.fromEntries(visibleSectionIds.map(id => [id, true])))
  }
  const collapseAll = () => {
    setStageStates(Object.fromEntries(visibleStageIds.map(id => [id, false])))
    setSectionStates(Object.fromEntries(visibleSectionIds.map(id => [id, false])))
  }

  let state: React.ReactNode
  if (selectedAttempt || clientContent || props.loading) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <RequestContentsToolbar
          search={search}
          onSearchChange={setSearch}
          onJump={jumpToMatch}
          searchQuery={searchQuery}
          activeMatchIndex={activeMatchIndex}
          totalMatches={totalMatches}
          loading={contentsLoading}
          expandable={expandable}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
        />
        <RequestContentsBody
          scrollRef={contentRef}
          error={props.error}
          selectedAttempt={selectedAttempt}
          appliedRules={appliedRules}
          loading={contentsLoading}
          bodiesError={bodiesError}
          onRetryBodies={() => void bodiesQuery.refetch()}
          noMatchQuery={searchQuery && !contentsLoading && !bodiesError && totalMatches === 0 ? searchQuery : null}
          pruned={bodiesMissing}
          stages={stages}
          stageStates={stageStates}
          onStageOpenChange={(id, open) => setStageStates(current => ({ ...current, [id]: open }))}
          sectionStates={sectionStates}
          onSectionOpenChange={(id, open) => setSectionStates(current => ({ ...current, [id]: open }))}
          search={searchResult}
          activeMatchIndex={searchQuery && totalMatches > 0 ? activeMatchIndex : null}
          showNotDelivered={Boolean(selectedAttempt && !servesClient && !contentsLoading)}
        />
      </div>
    )
  } else if (props.selectedAttemptId) {
    state = <div className="py-8 text-center system-xs-regular text-text-tertiary">{t('requestLogs.contents.noRecord')}</div>
  } else {
    state = null
  }

  return (
    <Sheet open={Boolean(props.selectedAttemptId)} onOpenChange={open => !open && props.onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-3xl! flex-col gap-0 border-0 bg-background p-0 shadow-none" onOpenAutoFocus={event => event.preventDefault()}>
        <RequestContentsHeader selectedAttempt={selectedAttempt} attemptCount={props.attempts.length} />
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
