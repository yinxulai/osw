import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { PANEL_COMPONENT_MAP } from '../panel'
import { NodePanelHint } from '../panel/panel-fields'
import { isProtectedNode, nodePanelHint } from '../node-meta'
import type { NodePanelUpdate, NodePanelProps as NodePanelBodyProps } from '../node-data'
import type { WorkflowNodeModel } from '@common/router/types'
import { BlockIcon } from './block-icon'
import { WorkflowButton } from './workflow-button'

/** 面板最小宽度。 */
const MIN_PANEL_WIDTH = 380
/** 面板展开时至少留给画布的宽度。 */
const RESERVED_CANVAS_WIDTH = 380

export function computeMaxPanelWidth(canvasWidth: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.floor(canvasWidth - RESERVED_CANVAS_WIDTH))
}

/**
 * 外壳样式。
 *
 * 宽度不写在这里：面板可拖拽改宽，那是内联 style 的活。这里只处理公共 `SheetContent`
 * 里会挡住内联宽度的默认值——`data-[side=right]:w-3/4`（被内联 style 压过）与
 * `data-[side=right]:sm:max-w-sm`（384px 上限，靠 `!` 顶掉，否则拉宽到 420px 以上会被压回去）。
 *
 * `workflow-node-panel` / `workflow-ui-surface` 两个作用域类必须挂在浮层元素自己身上：
 * `styles/index.css` 里节点面板的输入框/圆角刻度靠它们生效，而浮层会被 portal 到 body，拿不到画布的祖先作用域。
 */
const NODE_PANEL_CLASSNAME = cn(
  'workflow-node-panel workflow-ui-surface outline-hidden',
  'max-w-[calc(100vw-2rem)]! gap-0! border-l-[0.5px] border-components-panel-border bg-components-panel-bg!',
)

type WorkflowNodePanelProps = {
  model: WorkflowNodeModel
  /** 画布宽度，用于限制面板最大宽度 */
  canvasWidth: number
  width: number
  onWidthChange: (width: number) => void
  nodeModels: WorkflowNodeModel[]
  logicalModels: NodePanelBodyProps['logicalModels']
  conditionFieldHints: NodePanelBodyProps['conditionFieldHints']
  updateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

/**
 * 节点配置浮层。
 *
 * 面板本体用公共 `Sheet`（右侧 `side="right"`）承载：浮层被 portal 到 body、
 * 自带遮罩与进出场动画，画布与页面布局完全不动——窗口级 `fixed` 面板会去挤标题栏按钮。
 *
 * 内部分段沿用上游 `app/components/workflow/panel/index.tsx` +
 * `nodes/_base/components/workflow-panel/index.tsx`：标题行 / 描述 / 滚动正文 / 删除。
 */
export function WorkflowNodePanel(props: WorkflowNodePanelProps) {
  const {
    model,
    canvasWidth,
    width,
    onWidthChange,
    nodeModels,
    logicalModels,
    conditionFieldHints,
    updateNode,
    onDelete,
    onClose,
  } = props

  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width
  const detachOnUnmount = useRef<(() => void) | null>(null)

  const maxWidth = computeMaxPanelWidth(canvasWidth)
  const boundedWidth = Math.min(Math.max(width, MIN_PANEL_WIDTH), maxWidth)

  // 画布变窄时把超宽的面板拽回来。
  //
  // 这里刻意用 `widthRef` 读当前宽度、而不是把 `width` 写进依赖数组：
  // 本副作用会写 `onWidthChange`（父级 `panelWidth`），如果 `width` 也是依赖，
  // 就成了「副作用写自己的依赖」，正是 Maximum update depth 的成因。
  // 依赖只留外部的 `canvasWidth` 后，只有画布真的变化才会跑一次。
  useEffect(() => {
    const current = widthRef.current
    if (current > computeMaxPanelWidth(canvasWidth)) onWidthChange(computeMaxPanelWidth(canvasWidth))
  }, [canvasWidth, onWidthChange])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widthRef.current
    let frame: number | null = null
    let pending = startWidth

    const handleMove = (moveEvent: PointerEvent) => {
      pending = startWidth + (startX - moveEvent.clientX)
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        onWidthChange(pending)
      })
    }

    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      detachOnUnmount.current = null
    }

    const handleUp = () => {
      cleanup()
      onWidthChange(pending)
      setDragging(false)
    }

    detachOnUnmount.current = cleanup
    setDragging(true)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [onWidthChange])

  /**
   * 拖拽中途卸载（面板被关掉、节点被删掉）时把挂在 `window` 上的监听器收回来。
   *
   * 不收的话它们会继续按着那次拖拽的旧闭包调 `onWidthChange`：指针早就抬起来了，
   * 画布宽度却还在被一次已经结束的拖动推着走。
   */
  useEffect(() => () => { detachOnUnmount.current?.() }, [])

  const Body = PANEL_COMPONENT_MAP[model.kind]
  const protectedNode = isProtectedNode(model)
  // 便签不参与执行，也不在画布上展示说明行，所以这两块对它都不成立。
  const noteNode = model.kind === 'note'
  const update: NodePanelUpdate = updater => updateNode(model.id, updater)
  const t = useTranslation()

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={NODE_PANEL_CLASSNAME}
        style={{ width: `${boundedWidth}px` }}
      >
        {/* Radix 要求浮层里存在标题；节点名本身是可编辑输入框，标题只留给读屏。 */}
        <SheetTitle className="sr-only">{t('router.nodePanel.title')}</SheetTitle>

        {/* 拖拽把手压在面板左沿外侧半个身位：面板浮在画布之上，改宽只能靠自己，不能再靠挤占布局。 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('router.nodePanel.resizeAria')}
          onPointerDown={handleResizeStart}
          className="group/resize absolute inset-y-0 left-0 z-10 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
        >
          <span
            className={cn(
              'h-10 w-0.5 rounded-full bg-state-base-handle transition-all',
              dragging ? 'h-full bg-state-accent-solid' : 'group-hover/resize:h-full group-hover/resize:bg-state-accent-solid/70',
            )}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1.5">
          <BlockIcon kind={model.kind} size="md" />

          {protectedNode
            ? <span className="min-w-0 flex-1 truncate system-sm-semibold text-text-primary">{model.name}</span>
            : (
              <Input
                value={model.name}
                onChange={event => updateNode(model.id, current => ({ ...current, name: event.target.value }))}
                className="h-7 min-w-0 flex-1 text-sm"
              />
            )}

          {!noteNode && (
            <Switch
              checked={model.enabled}
              onCheckedChange={checked => updateNode(model.id, current => ({ ...current, enabled: checked }))}
            />
          )}

          <button
            type="button"
            aria-label={t('router.nodePanel.closeAria')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {!noteNode && (
          <div className="shrink-0 px-3 py-1">
            {protectedNode
              ? <div className="system-xs-regular text-text-tertiary">{model.description}</div>
              : (
                <Textarea
                  value={model.description}
                  onChange={event => updateNode(model.id, current => ({ ...current, description: event.target.value }))}
                  placeholder={t('router.nodePanel.descriptionPlaceholder')}
                  className="min-h-14 text-xs"
                />
              )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <div className="grid gap-3">
            <NodePanelHint>{nodePanelHint(t, model)}</NodePanelHint>

            <Body
              model={model}
              update={update}
              nodeModels={nodeModels}
              logicalModels={logicalModels}
              conditionFieldHints={conditionFieldHints}
            />
          </div>
        </div>

        {!protectedNode && (
          <div className="flex shrink-0 items-center justify-end px-3 pt-2 pb-3">
            <WorkflowButton
              variant="ghost-destructive"
              size="medium"
              onClick={() => onDelete(model.id)}
            >
              <Trash2 className="size-3.5" aria-hidden /> {t('router.nodeAction.delete')}
            </WorkflowButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
