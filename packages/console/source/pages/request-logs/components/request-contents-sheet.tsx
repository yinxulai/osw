import * as React from 'react'
import type { AppliedRequestRewriteRule, AttemptContentSummary, RequestContentSummary, RequestLogEntryAttempt } from '@common/schemas'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { useLocale, useTranslation } from '@/i18n/provider'
import { useRequestLogBodiesQuery } from '../queries'
import { buildContentStages, mergeAttemptContent, mergeClientContent, type ContentStage } from '../lib/contents'
import { buildErrorReport } from '../lib/error-report'
import { clientCommandInput, upstreamCommandInput } from '../lib/request-commands'
import { saveTextFile } from '../lib/request-body-download'
import { useContentsSearch } from '../hooks/use-contents-search'
import { RequestContentsActions } from './request-contents-actions'
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
  /**
   * 代理监听地址，用来把客户端记录里的路径拼成可直接执行的 URL。
   *
   * `null` 表示代理没在监听（或地址未知），此时「复制客户端原始请求」这一档不成立；
   * 上游那一档不受影响——它的地址是尝试自己记下的绝对 URL。
   */
  origin: string | null
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
  const toast = useToast()
  const locale = useLocale()
  const [reportPending, setReportPending] = React.useState(false)
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
  // 客户端视角每个请求只有一行，不需要按 attemptId 筛选。
  const clientSummary = props.contents?.[0] ?? null
  const attemptContent = mergeAttemptContent(attemptSummary, bodies)
  const clientContent = mergeClientContent(clientSummary, bodies)

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

  const nav = useContentsSearch({ selectedAttemptId: props.selectedAttemptId, stages })

  // 一条正文都没有：被保留策略清掉了，或采集正文的开关一直是关的。
  // 这两种情况在数据上无法区分（都是「没有行」），因此只说事实、不猜原因。
  // 加载中（还可能取到）、取正文失败（取不到）、详情失败（压根不知道有没有）都不是「没有」，
  // 不能混进这条结论。
  const bodiesMissing = props.error === null && !contentsLoading && bodiesError === null && nav.sections.length === 0

  /**
   * 下载错误报告。
   *
   * 报告要的是**原文**，因此这里不看当前界面上的折叠/搜索状态：重新拿到一整份正文
   * （面板已经取过就直接用，没取过就现取一次），按 `attemptId` / `id` 对齐，
   * 缺的部分在报告里写成「未采集」。
   *
   * 不做「只有失败才给」的限定：成功但内容不对（截断的 SSE、与声明不符的结构）
   * 同样是要供应商跟进的事故，而报告里的 HTTP 状态本来就把这一区别写清了。
   * 换成「失败才出现」会让标题栏的高度和按钮位置随数据跳动。
   */
  const downloadReport = selectedAttempt === null
    ? null
    : async () => {
        setReportPending(true)
        try {
          const all = bodies ?? (await bodiesQuery.refetch()).data ?? null
          if (all === null) throw new Error(t('requestLogs.detail.downloadErrorReportFailed'))
          const upstreamSummary = props.attemptContents?.find(content => content.attemptId === selectedAttempt.id) ?? null
          const file = buildErrorReport({
            t,
            locale,
            requestId: props.requestId,
            attempt: selectedAttempt,
            clientProtocol: props.clientProtocol,
            attemptContent: mergeAttemptContent(upstreamSummary, all),
            clientContent: mergeClientContent(clientSummary, all),
            servesClient,
            generatedTime: Date.now(),
          })
          saveTextFile(file, 'text/markdown')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('requestLogs.detail.downloadErrorReportFailed'))
        } finally {
          setReportPending(false)
        }
      }

  /**
   * 复制「发往供应商的请求」的输入。
   *
   * 上游视角与客户端视角不是同一份报文：地址是尝试自己的 `url`（已按供应商拼好），
   * 头与正文是改写与协议转换之后的那一份。拿客户端的报文去冒充，得到的只会是另一个结果。
   */
  const upstreamInput = upstreamCommandInput(selectedAttempt, attemptContent, clientContent?.requestMethod ?? null)
  /** 复制「客户端原始请求」的输入；代理地址未知时这一档不可用。 */
  const clientInput = clientCommandInput(props.origin, clientContent)

  let state: React.ReactNode
  if (selectedAttempt || clientContent || props.loading) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <RequestContentsToolbar
          search={nav.search}
          onSearchChange={nav.setSearch}
          onJump={nav.jumpToMatch}
          searchQuery={nav.searchQuery}
          activeMatchIndex={nav.activeMatchIndex}
          totalMatches={nav.totalMatches}
          loading={contentsLoading}
          expandable={nav.expandable}
          onExpandAll={nav.expandAll}
          onCollapseAll={nav.collapseAll}
        />
        <RequestContentsBody
          scrollRef={nav.contentRef}
          error={props.error}
          selectedAttempt={selectedAttempt}
          appliedRules={appliedRules}
          loading={contentsLoading}
          bodiesError={bodiesError}
          onRetryBodies={() => void bodiesQuery.refetch()}
          noMatchQuery={nav.searchQuery && !contentsLoading && !bodiesError && nav.totalMatches === 0 ? nav.searchQuery : null}
          pruned={bodiesMissing}
          stages={stages}
          stageStates={nav.stageStates}
          onStageOpenChange={nav.setStageOpen}
          sectionStates={nav.sectionStates}
          onSectionOpenChange={nav.setSectionOpen}
          search={nav.searchResult}
          activeMatchIndex={nav.searchQuery && nav.totalMatches > 0 ? nav.activeMatchIndex : null}
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
        <RequestContentsHeader
          selectedAttempt={selectedAttempt}
          attemptCount={props.attempts.length}
          actions={(
            <RequestContentsActions
              clientInput={clientInput}
              upstreamInput={upstreamInput}
              hasClientContent={clientContent !== null}
              onDownloadReport={downloadReport === null ? null : () => void downloadReport()}
              reportPending={reportPending}
            />
          )}
        />
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
