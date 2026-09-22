import { Activity } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import type { LiveRequest, LiveRequestPhase, RequestStatus } from '@common/schemas'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { executionSnapshotOf, type ExecutionSnapshot } from '../lib/execution'
import { formatBytes, formatNumber, formatStatus, formatTransport } from '../lib/format'
import {
  timelineOf,
  type HealthFailureScope,
  type TimelineMessage,
  type TimelineNode,
  type TimelineTone,
} from '../lib/timeline'
import { DetailSection, MetaFact } from './request-detail-primitives'

/**
 * 进行中请求的展开区。
 *
 * 它和已结束请求的详情**故意不同构**：历史详情是在复盘（一次请求已经结束，唯一的任务是把
 * 所有能算出来的数字一次摆齐，所以它是一张静态的指标表），而这里在直播（读者站在请求外面
 * 等结果，想知道的是「现在到哪一步了、还快不快、有没有出事」——一个随时间推进的过程）。
 *
 * 但两者仍在**同一套版式里**：顶部都是「标题 + 一行事实」的发丝线头，正文都是
 * `DetailSection` 分块，行内文字尺寸也照抄列表那一套（标题 13px medium / 节点 12px /
 * 补充 11px / 数字走 mono）。差别只在内容挑了什么，不在字形与间距——展开区是同一张表的
 * 一部分，它不该看起来像另一个应用。
 *
 * 于是这里只有两块：
 *
 * 1. **一句现在时**。标题行说的是这一步正在干什么（挑上游 / 连上游 / 等响应头 / 等首字节 /
 *    边收边回），下面一行事实对是逻辑模型、重试进度、落点、已用时、输出速度。
 * 2. **一条时间轴**。左边是偏移量（`+340ms`），中间是连起来的节点，右边是一句人话。
 *    它把「已选定落点」「已发往 X」「上游响应 200」「改试 Y」「完成」讲成一个能顺读的故事，
 *    而折叠行那一排格子只能给出故事的结论。故障转移是这条轴上最值得读的一段：
 *    被放弃的那次尝试不是直接消失，而是留下「为什么放弃」（状态码 / 形态不符 /
 *    健康度降级范围）与「接下来试谁」，因此一条试过三家才成功的请求，在这里
 *    读起来是三段有因果的尝试，而不是三个并列的结论。
 *
 * 有意省掉的东西：协议、传输形态、方法、路径、发起时刻都留在折叠行上（那里已经写着，
 * 且与历史行同一套列）；请求 ID 在落定后的历史详情里可以复制。展开一条还在跑的请求时，
 * 这些字段一个都不帮读者判断「要不要继续等」，挤进来只会把上面两件事冲淡。
 */

/**
 * 「此刻在干什么」的一句话。
 *
 * `awaiting-upstream` 与 `awaiting-first-byte` 必须分开说：前者是上游还没回头，后者是上游已经
 * 回了头（响应头都到了）却迟迟不吐字。合成一句「等上游」时，这两种卡法就分不出来了。
 */
const NOW_LABEL_KEY: Record<LiveRequestPhase, UiCatalogKey> = {
  routing: 'requestLogs.execution.now.routing',
  connecting: 'requestLogs.execution.now.connecting',
  'awaiting-upstream': 'requestLogs.execution.now.awaitingUpstream',
  'awaiting-first-byte': 'requestLogs.execution.now.awaitingFirstByte',
  streaming: 'requestLogs.execution.now.streaming',
  settled: 'requestLogs.execution.now.settled',
}

/** 标题前那枚圆点的成色：跑着是强调色，落定之后按结果给色。 */
const OUTCOME_MARKER_CLASS: Record<RequestStatus, string> = {
  pending: 'text-text-accent',
  success: 'text-text-success',
  failed: 'text-text-destructive',
  cancelled: 'text-text-quaternary',
}

const TONE_MARKER_CLASS: Record<TimelineTone, string> = {
  neutral: 'text-text-quaternary',
  active: 'text-text-accent',
  success: 'text-text-success',
  warn: 'text-text-warning',
  error: 'text-text-destructive',
}

/**
 * 节点标题色。
 *
 * 中性节点压到二级灰，让「成功/失败/断线」这些真正要一眼看到的节点自己跳出来——
 * 一条时间轴上大部分节点都是过程记录，如果每个都用正文色，出事的那一行就淹了。
 */
const TONE_TITLE_CLASS: Record<TimelineTone, string> = {
  neutral: 'text-text-secondary',
  active: 'text-text-primary',
  success: 'text-text-success',
  warn: 'text-text-warning',
  error: 'text-text-destructive',
}

interface RequestExecutionDetailRowProps {
  live: LiveRequest
  /** 逻辑模型的展示名（由页面统一解析，缺失时页面已经兜过底）。 */
  modelName: string
  /** 由所在的行统一提供，保证同一块里几处耗时说的是同一个时刻。 */
  now: number
}

export function RequestExecutionDetailRow(props: RequestExecutionDetailRowProps) {
  const { live } = props
  const running = live.status === 'pending'
  const snapshot = executionSnapshotOf(live, props.now)

  return (
    <tr className="bg-inset">
      <td colSpan={11} className="border-b border-border/40 p-0">
        {/*
         * `contain: inline-size` 是在给这张表「拆弹」：展开区里放着上游分块原文、
         * 错误信息、候选链这类**不可断行的长串**，而表格是自动布局——跨列单元格的
         * 最小内容宽度会被算进列宽，最长的那串就能把整张表撑宽，撑到容器装不下时
         * 又冒出一条横向滚动条。预览每 150 毫秒换一次，宽度就跟着抖一次。
         *
         * 加上它之后，这块内容的固有宽度不再参与表格的列宽计算（宽度只由单元格决定，
         * 展开区内部照旧按容器宽度排版），表宽因此只跟表头与普通行有关。
         */}
        <div className="bg-card px-5 py-4 contain-[inline-size]">
          <ExecutionHeadline
            live={live}
            modelName={props.modelName}
            snapshot={snapshot}
            running={running}
          />
          <ExecutionTimeline live={live} snapshot={snapshot} running={running} />
        </div>
      </td>
    </tr>
  )
}

interface ExecutionHeadlineProps {
  live: LiveRequest
  modelName: string
  snapshot: ExecutionSnapshot
  running: boolean
}

/**
 * 展开区最上面那句「现在时」。
 *
 * 版式照抄历史详情的头部（见 `request-log-detail-row.tsx`）：标题行 + 一条底部分隔线，
 * 下面一行事实对。历史详情的头部回答「这是哪条请求」，这里回答「它现在在干什么」，
 * 槽位是同一个，读的时候不用重新找位置。
 */
function ExecutionHeadline(props: ExecutionHeadlineProps) {
  const t = useTranslation()
  const { live, snapshot } = props
  const attempt = snapshot.attempt
  const headline = props.running ? t(NOW_LABEL_KEY[live.phase]) : formatStatus(t, live.status)
  const modelLabel = live.logicalModelId === null ? t('requestLogs.detail.unresolved') : props.modelName
  const targetLabel = attempt === null ? null : `${attempt.providerName}/${attempt.providerModelName}`

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'relative flex size-1.5 shrink-0 items-center justify-center',
              OUTCOME_MARKER_CLASS[live.status],
            )}
          >
            {props.running && (
              <span className="absolute size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
            )}
            <span className="relative size-1.5 rounded-full bg-current" />
          </span>
          <span className="system-sm-medium text-text-primary">{headline}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 system-2xs-regular">
          <MetaFact label={t('requestLogs.detail.logicalModel')} value={modelLabel} />
          {/* 落点还没选出来时整条不占位：这一行本来就是「有则读」的事实，不是固定栅格。 */}
          {targetLabel !== null && (
            <MetaFact label={t('requestLogs.table.providerModel')} value={targetLabel} mono />
          )}
          {/* 试到第几个：一次就成功时它也好用——分母说的是「一共排了几家」，
              分母取候选总数而不是已试次数，失败转移后才读得出「还剩几家没试」。 */}
          {snapshot.attemptCount > 0 && (
            <MetaFact
              label={t('requestLogs.execution.attempt')}
              value={t('requestLogs.execution.attemptValue', {
                index: snapshot.attemptCount,
                total: Math.max(snapshot.candidateCount, snapshot.attemptCount),
              })}
              mono
            />
          )}
          <MetaFact label={t('requestLogs.execution.elapsed')} value={formatMilliseconds(snapshot.elapsedMilliseconds)} />
          <MetaFact label={t('requestLogs.metric.outputSpeed')} value={formatOutputSpeed(snapshot.outputTokensPerSecond)} />
        </div>
      </div>
    </div>
  )
}

interface ExecutionTimelineProps {
  live: LiveRequest
  snapshot: ExecutionSnapshot
  running: boolean
}

function ExecutionTimeline(props: ExecutionTimelineProps) {
  const t = useTranslation()
  const nodes = useMemo(() => timelineOf(props.live), [props.live])

  return (
    <DetailSection icon={Activity} title={t('requestLogs.execution.timeline')}>
      <ol className="py-1.5">
        {nodes.map((node, index) => (
          <TimelineEvent
            key={node.key}
            node={node}
            /* 「此刻」排在最后，所以只有它不是尾节点时中间的竖线才画到底。 */
            last={!props.running && index === nodes.length - 1}
          />
        ))}
        {props.running && <TimelineTail snapshot={props.snapshot} />}
      </ol>
    </DetailSection>
  )
}

interface TimelineEventProps {
  node: TimelineNode
  last: boolean
}

function TimelineEvent(props: TimelineEventProps) {
  const t = useTranslation()
  const description = describeNode(props.node.message, t)

  return (
    <TimelineItem
      offsetMilliseconds={props.node.offsetMilliseconds}
      tone={props.node.tone}
      last={props.last}
      title={description.title}
      detail={description.detail}
    />
  )
}

interface TimelineTailProps {
  snapshot: ExecutionSnapshot
}

/**
 * 时间轴末端那个「此刻」。
 *
 * 它不来自事件，是**画出来的**：一条还在跑的请求，最后一条事件可能已经是半秒之前的事，
 * 只读事件会让人以为它停了。这个节点跟着时钟往下走，报出此刻累计收到的字节与输出 Token——
 * 这两个数在事件流里没有对应事件（它们每秒都在变），只能在这里出现。
 *
 * 标题**故意不再说一遍「正在生成回复」**：那句话就在上方的标题行里，隔几行重复同一句
 * 只会让时间轴的末尾显得像回音。这里只放事实。
 *
 * 事实里多了一份上游**最新一个**分块的原文预览：报告「收了多少字节」只回答了量，
 * 没回答「收的是什么」。预览刻意**不解析**——SSE 事件、上游回的 HTML 错误页、一串二进制，
 * 在发现之前谁也不知道长什么样，先解成「字段一、字段二」反而把意外情况抹平了。
 */
function TimelineTail(props: TimelineTailProps) {
  const t = useTranslation()
  const { snapshot } = props
  const tokens = snapshot.outputTokens !== null && snapshot.outputTokens > 0
    ? t('requestLogs.execution.tokens', { count: formatNumber(snapshot.outputTokens) })
    : null

  return (
    <TimelineItem
      offsetMilliseconds={snapshot.elapsedMilliseconds}
      tone="active"
      active
      last
      title={t('requestLogs.execution.received', { size: formatBytes(snapshot.receivedBytes) })}
      detail={tokens ?? undefined}
    >
      <ChunkPreview preview={snapshot.chunkPreview} />
    </TimelineItem>
  )
}

interface ChunkPreviewProps {
  preview: string | null
}

/**
 * 上游最新一个分块的预览：一行、不换行、不解析。
 *
 * 只画**最新那一块**，不做历史列表。这里要回答的是「上游此刻在回什么」，而一份会自己滚动的
 * 列表既要求读者去追它，又要在内存里多存一份正文；正文该看的时候会在正文面板里。
 *
 * 这一个块里的换行（SSE 事件本来就带空行）折叠成一个空格，超出宽度的部分交给 CSS 截断——
 * 预览只负责「开头长什么样」。
 *
 * 还没有分块时**也占着这一行**，只把内容换成占位符：这一行若随数据有无而出现、消失，
 * 尾巴节点就会在「上游还没回」到「上游回了」之间长高一行——一屏里别的都不动，只有它在跳，
 * 看起来就像面板在抖。行高恒定比省下那一行更要紧。
 */
function ChunkPreview(props: ChunkPreviewProps) {
  return (
    <div className="mt-1.5 w-full truncate border-t border-border/40 pt-1.5 font-mono system-2xs-regular text-text-quaternary">
      {props.preview ?? '—'}
    </div>
  )
}

interface TimelineItemProps {
  offsetMilliseconds: number
  tone: TimelineTone
  last?: boolean
  /** 正在发生的那个节点：圆点带一圈扩散。 */
  active?: boolean
  title: string
  detail?: string
  /** 标题与补充下面附加的一块内容（目前只有末端节点用它挂分块预览）。 */
  children?: ReactNode
}

/**
 * 时间轴上的一行。
 *
 * 骨架与历史详情里的尝试行（`AttemptRow`）对齐：同样的 `px-3 py-2` 行内边距、同样的
 * mono 数字列贴右、同样的 12px 主文 + 11px 补充。差别只在中间多一条轴线——那正是「这是一
 * 条线」这件事本身，而不是另一套排版。
 */
function TimelineItem(props: TimelineItemProps) {
  return (
    <li className="grid grid-cols-[3rem_auto_minmax(0,1fr)] items-start gap-x-3 px-3 py-2">
      <span className="text-right font-mono system-2xs-regular tabular-nums text-text-quaternary">
        +{formatMilliseconds(props.offsetMilliseconds)}
      </span>
      {/* 竖线要撑到这一行下沿，所以这一列得忽略 `items-start` 自己去拉伸。 */}
      <span className="relative flex flex-col items-center self-stretch pt-1">
        <span
          className={cn('relative flex size-1.5 shrink-0 items-center justify-center', TONE_MARKER_CLASS[props.tone])}
        >
          {props.active && (
            <span className="absolute size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
          )}
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
        {!props.last && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
      </span>
      <div className="min-w-0">
        <div className={cn('truncate system-xs-medium', TONE_TITLE_CLASS[props.tone])}>{props.title}</div>
        {props.detail !== undefined && (
          <div className="mt-0.5 truncate system-2xs-regular text-text-quaternary">{props.detail}</div>
        )}
        {props.children}
      </div>
    </li>
  )
}

interface DescriptionOfNode {
  title: string
  detail?: string
}

/** 健康度被降到哪一档——`none` 没有可说的（它只说明这次没算作故障）。 */
const HEALTH_SCOPE_KEY: Record<Exclude<HealthFailureScope, 'none'>, UiCatalogKey> = {
  'provider': 'requestLogs.execution.scope.provider',
  'provider-model': 'requestLogs.execution.scope.providerModel',
}

/**
 * 把一个节点要说的话翻成当前语言。语言相关的部分全收在这里，时间轴本身只认结构。
 *
 * 节点的**一句话只讲一个事实**，多出来的细节全进 `detail`：标题是扫读时看的那一列，把
 * 「改试谁」「为什么改试」「降级了谁」都塞进标题，出事的那一行就不跳了。多条事实之间用 `·`
 * 连成一串（与列表行、历史尝试行同一套写法），不换行、不缩进，长度超了交给 CSS 截断。
 */
function describeNode(message: TimelineMessage, t: AppTranslator): DescriptionOfNode {
  switch (message.kind) {
    case 'received':
      return { title: t('requestLogs.execution.node.received', { method: message.method, path: message.path }) }

    case 'routeResolved': {
      const count = message.candidates.length
      return {
        title: t('requestLogs.execution.node.routeResolved'),
        // 候选是按优先级排的，所以顺序本身就是信息：它预告了出事之后会往谁那儿退。
        detail: count === 0
          ? undefined
          : `${t('requestLogs.execution.candidates', { count })} · ${message.candidates.join(' → ')}`,
      }
    }

    case 'attemptStart':
      return {
        title: t('requestLogs.execution.node.attemptStart', {
          provider: providerLabel(message.providerModelName, t),
          index: message.attemptNumber,
        }),
      }

    case 'prepared': {
      const parts: string[] = []
      // 命中的修改器要**点名**：只说「命中 2 条」回答不了「是哪两个修改器动过我的请求」，
      // 而那正是看到「请求被改过」之后的下一个问题。名字还没带上来的老快照才回落成计数。
      if (message.appliedRuleNames.length > 0) {
        parts.push(t('requestLogs.execution.rulesApplied', { names: message.appliedRuleNames.join(', ') }))
      } else if (message.appliedRules > 0) {
        parts.push(t('requestLogs.execution.ruleApplied', { count: message.appliedRules }))
      }
      // 协议转换只在两跳都读得到时才写出来：只说「转换过」而不说是哪两跳，等于说了半句。
      if (message.converted && message.protocolFrom !== null && message.protocolTo !== null) {
        parts.push(t('requestLogs.execution.protocolConverted', { from: message.protocolFrom, to: message.protocolTo }))
      }
      return {
        title: t('requestLogs.execution.node.prepared', { size: formatBytes(message.requestBytes) }),
        detail: parts.length === 0 ? undefined : parts.join(' · '),
      }
    }

    case 'upstreamHead': {
      const parts: string[] = []
      if (message.mismatch) {
        // 形态不符是「为什么改试」的答案，比状态码本身更能解释这次失败。
        parts.push(t('requestLogs.execution.headMismatch', {
          actual: formatTransport(t, message.upstreamTransport),
          requested: formatTransport(t, message.requestedTransport),
        }))
      } else if (message.upstreamTransport === 'http-stream') {
        parts.push(t('requestLogs.execution.headStreamed'))
      }
      // 这次响应会不会交给客户端。`failover` 不给话：下一行就是「改试」，两句连读反而更顺。
      if (message.disposition === 'success') parts.push(t('requestLogs.execution.headDeliver'))
      else if (message.disposition === 'terminal') parts.push(t('requestLogs.execution.headTerminal'))
      return {
        title: t('requestLogs.execution.node.upstreamHead', {
          provider: providerLabel(message.providerModelName, t),
          httpStatus: message.httpStatus ?? '—',
        }),
        detail: parts.length === 0 ? undefined : parts.join(' · '),
      }
    }

    case 'firstByte':
      return {
        title: t('requestLogs.execution.node.firstByte', {
          provider: providerLabel(message.providerModelName, t),
        }),
        detail: message.ttftMilliseconds === null
          ? undefined
          : t('requestLogs.execution.firstByteLatency', { value: formatMilliseconds(message.ttftMilliseconds) }),
      }

    case 'attemptFailed': {
      const parts: string[] = []
      // 「改试谁」是这一行最重要的话，所以它排在 state 之前。
      if (message.nextProviderModelName !== null) {
        parts.push(t('requestLogs.execution.node.failover', { provider: message.nextProviderModelName }))
      }
      if (message.httpStatus !== null) parts.push(`HTTP ${message.httpStatus}`)
      // 降级范围解释了「这家之后还会不会被选中」，是故障转移里唯一能影响下一次请求的事实。
      if (message.healthScope !== 'none') {
        parts.push(t('requestLogs.execution.healthDegraded', { scope: t(HEALTH_SCOPE_KEY[message.healthScope]) }))
      }
      return {
        title: t('requestLogs.execution.node.attemptFailed', { index: message.attemptNumber }),
        detail: parts.length === 0 ? undefined : parts.join(' · '),
      }
    }

    case 'completed':
      return {
        title: t('requestLogs.execution.node.completed', {
          httpStatus: message.httpStatus ?? '—',
          duration: formatMilliseconds(message.durationMilliseconds),
        }),
      }

    case 'failed':
      return {
        title: message.reason === null
          ? t('requestLogs.execution.node.failedPlain')
          : t('requestLogs.execution.node.failed', { reason: message.reason }),
      }

    case 'cancelled':
      return { title: t('requestLogs.execution.node.cancelled') }

    case 'rejected':
      return {
        title: message.errorCode === null
          ? t('requestLogs.execution.node.rejectedPlain')
          : t('requestLogs.execution.node.rejected', { errorCode: message.errorCode }),
      }

    case 'exhausted':
      return {
        title: message.attemptCount === null
          ? t('requestLogs.execution.node.exhaustedPlain')
          : t('requestLogs.execution.node.exhausted', { count: message.attemptCount }),
        // 全失败时最后一次上游响应是唯一还能归因的线索（例如 401：不是网络问题，是凭据问题）。
        detail: message.lastUpstreamStatus === null
          ? undefined
          : t('requestLogs.execution.node.lastUpstreamStatus', { httpStatus: message.lastUpstreamStatus }),
      }

    case 'raw':
      /* 契约层新加的事件在这里暂时读不懂，但至少要让人看见它发生过，并知道它叫什么。 */
      return { title: message.label }
  }
}

/** 事件里没带上游名时（例如查不到对应的尝试），用「上游」这个词，而不是一个空格。 */
function providerLabel(providerModelName: string | null, t: AppTranslator): string {
  return providerModelName ?? t('requestLogs.execution.node.upstream')
}
