import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import {
  NOTE_MAX_HEIGHT,
  NOTE_MAX_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
} from '@common/router/types'
import { renderNoteMarkdown } from '../markdown'
import { resolveNoteNodeSize } from '../node-meta'
import { startPointerDrag, type PointerDrag } from '../pointer-drag'
import type { RouteNodeProps } from '../node-data'

/** 把拖出来的长度夹到便签允许的区间里，并取整避免半像素抖出模糊文字。 */
function clampSize(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

/**
 * 备注便签的内容区。
 *
 * 便签是「画给人看」的节点：正文按 Markdown 渲染且只读（编辑在右侧面板里做），
 * 卡片本身可以拖右下角改尺寸，尺寸写进 `model.size`、由页面放到 React Flow 的节点样式上。
 * 它是唯一一个「尺寸不等于内容」的节点，所以缩放手柄只出现在这里。
 */
export function NoteNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model
  const flow = useReactFlow()
  const t = useTranslation()
  const dragRef = useRef<PointerDrag | null>(null)

  const size = useMemo(() => (model.kind === 'note' ? resolveNoteNodeSize(model) : null), [model])
  const html = useMemo(() => (model.kind === 'note' ? renderNoteMarkdown(model.text) : ''), [model])

  /**
   * 拖拽中途卸载（节点被删掉）时把挂在 `window` 上的监听器收回来，
   * 理由与右侧面板的拖宽手柄一致：不收的话它们会继续按那次拖拽的旧闭包写回尺寸。
   */
  useEffect(() => () => { dragRef.current?.stop() }, [])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!size) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const startWidth = size.width
    const startHeight = size.height
    // 指针走的是屏幕距离，卡片尺寸是画布单位：画布缩放后两者不再一一对应，得除以 zoom。
    const zoom = flow.getZoom() || 1

    dragRef.current = startPointerDrag({
      onMove: position => {
        data.onResizeNode(id, {
          width: clampSize(startWidth + (position.x - startX) / zoom, NOTE_MIN_WIDTH, NOTE_MAX_WIDTH),
          height: clampSize(startHeight + (position.y - startY) / zoom, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT),
        })
      },
      onEnd: () => { dragRef.current = null },
    })
  }, [data, flow, id, size])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* `nowheel`：便签正文可能很长，滚轮应该滚正文而不是缩放整张画布。
          不加 `nodrag`：整张便签（连同正文）都还是拖拽面。 */}
      <div className="nowheel min-h-0 flex-1 overflow-y-auto px-3 pb-3 system-xs-regular text-text-secondary">
        {html
          ? <div className="note-markdown" dangerouslySetInnerHTML={{ __html: html }} />
          : (
            <div className="rounded-lg border border-dashed border-amber-500/40 px-2 py-1.5 text-text-quaternary">
              {t('router.nodeView.noteEmpty')}
            </div>
          )}
      </div>

      {/* 右下角缩放手柄：`nodrag nopan` 是画布上的通用约定（见节点操作条），
          少了它按下手柄会同时触发节点拖动；`onClick` 只拦冒泡，免得一次缩放顺带把面板打开。 */}
      <div
        role="separator"
        aria-label={t('router.nodeView.noteResizeAria')}
        onPointerDown={handleResizeStart}
        onClick={event => event.stopPropagation()}
        className={cn(
          'nodrag nopan absolute right-0.5 bottom-0.5 flex size-4 cursor-nwse-resize touch-none items-end justify-end rounded-br-sm p-0.5 text-text-quaternary transition-opacity',
          data.isSelected ? 'opacity-100' : 'opacity-60 group-hover/node:opacity-100',
        )}
      >
        <span className="size-2.5 rounded-br-[3px] border-r-2 border-b-2 border-current" aria-hidden />
      </div>
    </div>
  )
}
