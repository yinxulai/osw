import { ArrowRight } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Textarea } from '@/components/ui/textarea'
import type { WorkflowRunResult } from '@common/router/types'
import type { NodeOutputGroup } from '../node-output'
import { WorkflowButton } from './workflow-button'
import { WorkflowRunResults } from './workflow-run-results'

interface WorkflowRunDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 输入框里的原始 JSON 文本（由页面持有：它也是「最近一次跑的是什么」的凭据）。 */
  payloadText: string
  onPayloadTextChange: (value: string) => void
  /** 解析输入失败时的原文；空串表示没有错误。 */
  payloadError: string
  /** 输入框行数；由页面按内容算好，窗口小的时候交给抽屉整体滚动。 */
  payloadRows: number
  result: WorkflowRunResult | null
  groups: NodeOutputGroup[]
  onRun: () => void
}

/**
 * 试运行抽屉：左半边是输入，右半边是结论，底部是关闭 / 运行。
 *
 * 抽屉只收「当前是什么」与「点了要干什么」，自己不解析负载、不调接口 ——
 * 那些留在页面那一层，因为图和逻辑模型列表都在那里。
 *
 * 输入与结果共用一个滚动容器：窗口变小时整体滚动，而不是输入区、结果区各滚各的
 * （结果里的 Trace 也不再单独滚动）。
 */
export function WorkflowRunDrawer(props: WorkflowRunDrawerProps) {
  const t = useTranslation()

  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange} direction="right">
      <DrawerContent className="workflow-test-drawer workflow-ui-surface h-full w-208! max-w-[90vw]! border-l-[0.5px] border-components-panel-border bg-background">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> {t('router.workflow.run')}</DrawerTitle>
          <DrawerDescription>{t('router.runPanel.description')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-2">
            <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.inputTitle')}</div>
            <Textarea
              value={props.payloadText}
              onChange={event => props.onPayloadTextChange(event.target.value)}
              rows={props.payloadRows}
              className="min-h-24 resize-none font-mono text-[12px] leading-5"
            />
            {props.payloadError && <div className="system-xs-regular text-text-destructive">{props.payloadError}</div>}
          </div>

          <div className="flex flex-col gap-3">
            <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.resultTitle')}</div>
            {!props.result && <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 system-xs-regular text-text-tertiary">{t('router.runPanel.emptyResult')}</div>}

            {props.result && <WorkflowRunResults result={props.result} groups={props.groups} />}
          </div>
        </div>

        <DrawerFooter className="flex-row justify-end">
          {/* 关闭在左、主操作在右：与规则模式那个试运行抽屉摆同一个位置，换个模式不用重新找按钮。 */}
          <WorkflowButton size="medium" onClick={() => props.onOpenChange(false)}>{t('common.action.close')}</WorkflowButton>
          <WorkflowButton size="medium" variant="primary" onClick={props.onRun}>{t('router.runPanel.run')}</WorkflowButton>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
