import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import type { LiveRequest, LiveRequestPhase } from '@common/schemas'
import { tableCellClass } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { executionSnapshotOf } from '../lib/execution'
import { PROTOCOL_LABEL, formatNumber, formatTime, formatTransport } from '../lib/format'
import { RequestExecutionDetailRow } from './request-execution-detail'

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
  toggleExpand: (id: string) => void
}

export function RequestExecutionRow(props: RequestExecutionRowProps) {
  const locale = useLocale()
  const t = useTranslation()
  const { live } = props
  const running = live.status === 'pending'
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
          <PhaseBadge phase={live.phase} running={running} />
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap font-mono text-text-tertiary')}>
          {formatTime(locale, live.startedAt)}
        </td>
        {/* 这一格与已结束的行逐字对齐：同样只写「最终落在谁身上」，多试几次时同样补一个 `+n`。 */}
        <td className={cn(tableCellClass, 'max-w-40')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate system-xs-medium text-text-primary">
              {attempt === null ? '—' : `${attempt.providerName}/${attempt.providerModelName}`}
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
      {props.expanded && <RequestExecutionDetailRow live={live} modelName={props.modelName} now={now} />}
    </Fragment>
  )
}

interface PhaseBadgeProps {
  phase: LiveRequestPhase
  running: boolean
}

/**
 * 进行中那一格报的是「走到哪一步」，而不是「成功还是失败」。
 *
 * 已结束的请求用状态徽标（成功/失败/已取消），因为它只需要回答结果；而一条还在路上的请求
 * 唯一有价值的答案是它现在卡在哪——是还在挑上游、已经发出去了、还是已经在往客户端写了。
 * 圆点在做的事是让「它还在动」这件事不用读文字就能看出来。
 */
function PhaseBadge(props: PhaseBadgeProps) {
  const t = useTranslation()
  return (
    <Badge variant={props.running ? 'info' : 'muted'} className="gap-1.5 font-normal">
      <span className="relative flex size-1.5 items-center justify-center">
        {props.running && <span className="absolute size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-ping" />}
        <span className="relative size-1.5 rounded-full bg-current" />
      </span>
      {t(PHASE_LABEL_KEY[props.phase])}
    </Badge>
  )
}
