import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import type { LiveRequest, LiveRequestPhase } from '@common/schemas'
import { tableCellClass } from '@/components/table-primitives'
import { liveRequestActivity } from '@/data/live-request-selectors'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { executionSnapshotOf } from '../lib/execution'
import { PROTOCOL_LABEL, formatNumber, formatStatus, formatTime, formatTransport } from '../lib/format'
import { RequestExecutionDetailRow } from './request-execution-detail'
import { StatusBadge } from './status-badge'

/**
 * 「正在执行」的请求在这张列表里的样子。
 *
 * 它占的是**同一个列表里的一行**，而不是列表上面另开的一块。理由是这一页只该回答一个问题
 * ——「我发出去的请求现在怎么样了」——而答案在时间上是连续的：先进行中，然后已完成。
 * 分成两块之后，同一条请求会在落定的那一刻从上面消失、在下面出现，用户读到的是一次跳变；
 * 合成一张表以后它只是原地换了一套字段。
 *
 * 这一行只管**一眼扫得完的东西**：状态、时刻、落点、协议、传输、Token、TTFT、TPS，
 * 与已结束的请求逐格对齐——同一条请求落定后不该换一副面孔。至于「为什么这么慢、路上
 * 到底发生了什么」，那是展开区的事，见 `request-execution-detail.tsx`。
 *
 * 台账里没有的字段一律写 `—`，不隐藏、不换排版——**布局不随数据有无而改变**，
 * 否则一条刚接上的请求会让整张表抖一下。
 */

const PHASE_LABEL_KEY: Record<LiveRequestPhase, UiCatalogKey> = {
  routing: 'requestLogs.phase.routing',
  connecting: 'requestLogs.phase.connecting',
  'awaiting-upstream': 'requestLogs.phase.awaitingUpstream',
  'awaiting-first-byte': 'requestLogs.phase.awaitingFirstByte',
  streaming: 'requestLogs.phase.streaming',
  settled: 'requestLogs.phase.settled',
}

/**
 * 让耗时自己走。
 *
 * 轮询最快一秒一次，而「已用时」按秒读，中间那一段只能由本地时钟补上。
 * 请求一落定就停：落定之后每一格数字都来自台账里冻结的值，再走就是假的。
 */
function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active])

  return now
}

interface RequestExecutionRowProps {
  live: LiveRequest
  expanded: boolean
  modelName: string
  /** 这条请求指向的逻辑模型已被删除时为 `true`（进行中的请求几乎不会撞上，删掉配置不影响已有请求）。 */
  modelDeleted: boolean
  toggleExpand: (id: string) => void
}

export function RequestExecutionRow(props: RequestExecutionRowProps) {
  const locale = useLocale()
  const t = useTranslation()
  const { live } = props
  const running = live.status === 'pending'
  const activity = liveRequestActivity(live)
  const now = useTickingNow(running)
  const snapshot = executionSnapshotOf(live, now)
  const { attempt } = snapshot
  const tps = formatOutputSpeed(snapshot.outputTokensPerSecond)

  return (
    <Fragment>
      <tr
        onClick={() => props.toggleExpand(live.id)}
        className={cn(
          'cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-state-base-hover',
          props.expanded && 'bg-inset',
        )}
      >
        <td className={cn(tableCellClass, 'text-text-quaternary')}>
          {props.expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </td>
        <td className={tableCellClass}>
          <PhaseBadge live={live} />
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap font-mono')}>
          <span className="text-text-quaternary">{formatTime(locale, live.startedAt)}</span>
          {/* 已用时写在时刻旁边而不是另占一列：它每秒都在变，是「还在跑」唯一的连续读数；
              而时刻是它属于哪一行。两者同一格里读，不必为了一个走秒的数字再开一列。
              它比时刻更亮一档——列表里真正会被反复扫的是「多久了」，不是「几点开始」。
              落定后这一格只剩时刻：那时耗时归详情，列表不必再留着它。 */}
          {running && (
            <span
              className="ml-2 tabular-nums text-text-secondary"
              title={t('requestLogs.execution.elapsed')}
            >
              {formatMilliseconds(snapshot.elapsedMilliseconds)}
            </span>
          )}
        </td>
        {/* 这一格与已结束的行逐字对齐：同样只写「最终落在谁身上」，多试几次时同样补一个 `+n`。 */}
        {/* 第一次尝试开始之前没有「落点」可写，但队列里已经有下一个候选了——那时写它，
            而不是留一个 `—`：屏幕前的人此刻最想知道的就是「它要往谁发」。 */}
        <td className={cn(tableCellClass, 'max-w-40')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate system-xs-medium text-text-primary">
              {attempt === null
                ? (snapshot.nextTarget === null ? '—' : `${snapshot.nextTarget.providerName}/${snapshot.nextTarget.providerModelName}`)
                : `${attempt.providerName}/${attempt.providerModelName}`}
            </span>
            {snapshot.attemptCount > 1 && (
              <span
                className="shrink-0 rounded-md bg-components-input-bg-normal px-1.5 py-0.5 font-mono system-2xs-medium text-text-tertiary"
                title={t('requestLogs.route.totalAttempts', { count: snapshot.attemptCount })}
              >
                +{snapshot.attemptCount - 1}
              </span>
            )}
          </div>
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap')}>
          {live.clientProtocol === null
            ? <span className="text-text-quaternary">—</span>
            : <span className="text-text-tertiary">{PROTOCOL_LABEL[live.clientProtocol] ?? live.clientProtocol}</span>}
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap text-text-tertiary')}>
          {formatTransport(t, live.transport)}
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(snapshot.inputTokens !== null && 'text-text-primary')}>
            {formatNumber(snapshot.inputTokens)}
          </span>
        </td>
        {/* 缓存读写只有上游回报之后才知道，请求进行中必然空缺——留 `—` 而不是把整列挤掉。 */}
        <td className={cn(tableCellClass, 'text-center')}>
          <span className="text-text-quaternary">—</span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(snapshot.outputTokens !== null && 'text-text-primary')}>
            {formatNumber(snapshot.outputTokens)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span
            className={cn(snapshot.ttftMilliseconds !== null && 'text-foreground')}
            title={snapshot.ttftMilliseconds === null ? t('requestLogs.execution.waitingFirstByte') : undefined}
          >
            {formatMilliseconds(snapshot.ttftMilliseconds)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(tps !== '—' && 'text-foreground')}>{tps}</span>
        </td>
      </tr>
      {props.expanded && (
        <RequestExecutionDetailRow
          live={live}
          modelName={props.modelName}
          modelDeleted={props.modelDeleted}
          now={now}
          activity={activity}
        />
      )}
    </Fragment>
  )
}

interface PhaseBadgeProps {
  live: LiveRequest
}

/**
 * 状态那一格：进行中写阶段名，落定后写结局名。
 *
 * 落定之后不能用 `phase` 之外的东西去猜结局——这里直接读 `status`，与已落库的行
 * 走同一个 `formatStatus`，所以一条请求落定那一刻只是文字变一下，位置与形状不动。
 */
function PhaseBadge(props: PhaseBadgeProps) {
  const t = useTranslation()
  const { live } = props
  const settled = live.phase === 'settled'

  return (
    <StatusBadge
      status={live.status}
      label={settled ? formatStatus(t, live.status) : t(PHASE_LABEL_KEY[live.phase])}
    />
  )
}
