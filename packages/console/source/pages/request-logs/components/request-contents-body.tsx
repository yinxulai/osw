import * as React from 'react'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { RequestLogEntryAttempt } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import type { ContentSearchResult } from '../lib/content-search'
import type { ContentStage } from '../lib/contents'
import type { AppliedRule } from './request-detail-primitives'
import { AppliedRules } from './request-detail-primitives'
import { AttemptError, AttemptFacts } from './request-contents-attempt'
import { RequestStage } from './request-contents-stage'

export interface RequestContentsBodyProps {
  /** 命中要滚动到的那条所在的容器；由宿主持有，因为定位发生在宿主的 effect 里。 */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 详情级错误：只挡需要详情才能展示的那几块。 */
  error: string | null
  selectedAttempt: RequestLogEntryAttempt | null
  appliedRules: readonly AppliedRule[]
  /** 正文还在路上。 */
  loading: boolean
  /** 取正文失败的原因；`null` 表示没失败。 */
  bodiesError: string | null
  onRetryBodies: () => void
  /** 有搜索词、且确定没有命中时要提示的搜索词；其余情况为 `null`。 */
  noMatchQuery: string | null
  /** 一条正文都没有（被保留策略清掉，或采集开关一直是关的）。 */
  pruned: boolean
  stages: ContentStage[]
  stageStates: Record<string, boolean>
  onStageOpenChange: (id: string, open: boolean) => void
  sectionStates: Record<string, boolean>
  onSectionOpenChange: (id: string, open: boolean) => void
  search: ContentSearchResult
  /** 当前激活的命中序号（全局）；没有搜索词时为 `null`。 */
  activeMatchIndex: number | null
  /** 这次尝试没有向客户端写出任何字节：要留一句解释，而不是让第四个阶段凭空消失。 */
  showNotDelivered: boolean
}

/**
 * 正文面板的滚动区。
 *
 * 顺序就是排障的顺序：先看这条结论对不对（错误横幅、尝试事实、命中的修改器），
 * 再看正文链路。因此这些块**不能**被归并成一组各管各的——顺序本身就是信息。
 */
export function RequestContentsBody(props: RequestContentsBodyProps) {
  const t = useTranslation()

  return (
    <div ref={props.scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
      {/* 详情级错误只挡「需要详情才能展示」的那几块，不能连尝试事实一起收走：
          事实来自随行一起到的尝试记录，它们是在详情失败时唯一不受影响的证据。 */}
      {props.error && (
        <div className="flex items-start gap-2 rounded-md border border-module-border bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
          <AlertCircle size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 wrap-break-word">{props.error}</span>
        </div>
      )}
      {props.selectedAttempt && <AttemptError attempt={props.selectedAttempt} />}
      {props.selectedAttempt && <AttemptFacts attempt={props.selectedAttempt} />}
      <AppliedRules rules={props.appliedRules} />
      {props.loading && (
        <div role="status" className="flex items-center gap-2 system-xs-regular text-text-tertiary">
          <LoaderCircle size={13} aria-hidden className="animate-spin" />
          {t('requestLogs.contents.loading')}
        </div>
      )}
      {/* 正文没取到与正文没采到是两件事：前者可以去重试，后者只能接受。 */}
      {props.bodiesError && (
        <div className="flex items-start gap-2 rounded-md border border-module-border bg-destructive/8 px-3 py-2 system-xs-regular">
          <AlertCircle size={14} aria-hidden className="mt-0.5 shrink-0 text-text-destructive" />
          <div className="min-w-0">
            <div className="text-text-destructive">{t('requestLogs.contents.bodiesError')}</div>
            <div className="mt-0.5 wrap-break-word text-text-secondary">{props.bodiesError}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 shrink-0"
            onClick={props.onRetryBodies}
          >
            {t('common.action.retry')}
          </Button>
        </div>
      )}
      {props.noMatchQuery && (
        <div className="rounded-md border border-module-border bg-inset px-3 py-2 system-xs-regular text-text-tertiary">
          {t('requestLogs.contents.noMatchHint', { query: props.noMatchQuery })}
        </div>
      )}
      {props.pruned && (
        <div className="rounded-md border border-dashed border-module-border px-3 py-2 system-xs-regular text-text-tertiary">
          {t('requestLogs.contents.pruned')}
        </div>
      )}
      {!props.bodiesError && props.stages.map(stage => (
        <RequestStage
          key={stage.id}
          {...stage}
          open={props.stageStates[stage.id] ?? false}
          onOpenChange={open => props.onStageOpenChange(stage.id, open)}
          sectionStates={props.sectionStates}
          onSectionOpenChange={props.onSectionOpenChange}
          search={props.search}
          activeMatchIndex={props.activeMatchIndex}
          loading={props.loading}
          empty={props.pruned}
        />
      ))}
      {/* 该阶段被隐藏的地方要留一句解释：否则「少了第四个阶段」既可能被读成界面出错，
          也可能被读成「正文丢了」（那由上面的 `pruned` 负责说明）。 */}
      {props.showNotDelivered && (
        <div className="rounded-md border border-dashed border-module-border px-3 py-2 system-xs-regular text-text-tertiary">
          {t('requestLogs.contents.clientResponseNotDelivered')}
        </div>
      )}
    </div>
  )
}
