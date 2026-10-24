import { Hand, LocateFixed, Lock, LockOpen, MousePointer2, Plus } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { AppendableKind } from '@common/router/types'
import { NodeSelector } from './node-selector'

export type CanvasDockMode = 'select' | 'pan'

interface WorkflowCanvasDockProps {
  mode: CanvasDockMode
  /** 是否允许拖动节点；关掉之后画布上任何拖动都不会改图。 */
  dragEnabled: boolean
  onModeChange: (mode: CanvasDockMode) => void
  onToggleDrag: () => void
  onFitView: () => void
  onAppendNode: (kind: AppendableKind) => void
}

/**
 * 画布底部的悬浮控制条：加节点 / 选择模式 / 平移模式 / 锁定拖动 / 自适应视图。
 *
 * 它整条盖在画布上（绝对定位 + `pointer-events-none` 的外壳），所以自己单独成一个组件：
 * 这些按钮的状态全来自画布外部（模式、锁定），回调也全交给画布层，它自己不持有任何状态。
 *
 * 容器样式对齐上游 `workflow/operator/control.tsx` 的悬浮控制条：
 * actionbar 底色与画布只差一档明度，因此保留上游的 0.5px 描边、省略阴影。
 */
export function WorkflowCanvasDock(props: WorkflowCanvasDockProps) {
  const t = useTranslation()
  const toggleClass = (active: boolean) => cn(
    'flex size-8 items-center justify-center rounded-lg transition-colors',
    active ? 'bg-state-accent-solid text-components-button-primary-text' : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary backdrop-blur-[5px]">
        <NodeSelector
          placement="top"
          onSelect={props.onAppendNode}
          trigger={(
            <button
              type="button"
              aria-label={t('router.canvas.addNodeAria')}
              className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          )}
        />

        <Separator orientation="vertical" className="mx-1!" />

        <button
          type="button"
          aria-label={t('router.canvas.selectModeAria')}
          className={toggleClass(props.mode === 'select')}
          onClick={() => props.onModeChange('select')}
        >
          <MousePointer2 className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('router.canvas.panModeAria')}
          className={toggleClass(props.mode === 'pan')}
          onClick={() => props.onModeChange('pan')}
        >
          <Hand className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={props.dragEnabled ? t('router.canvas.lockAria') : t('router.canvas.unlockAria')}
          className={toggleClass(!props.dragEnabled)}
          onClick={props.onToggleDrag}
        >
          {props.dragEnabled ? <LockOpen className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
        </button>

        <Separator orientation="vertical" className="mx-1!" />

        <button
          type="button"
          aria-label={t('router.canvas.fitViewAria')}
          className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
          onClick={props.onFitView}
        >
          <LocateFixed className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
