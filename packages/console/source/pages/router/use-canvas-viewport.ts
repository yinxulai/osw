import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'

const WORKFLOW_FIT_VIEW_OPTIONS = { padding: 0.04, minZoom: 0.66, maxZoom: 1 }

/**
 * 画布视口交互这一块：选择 / 平移模式、拖动开关、面板宽度、画布宽度、适配视图。
 *
 * 这是「怎么看、怎么导航这张画布」，与「画布上的图是什么」是两回事——图数据与节点操作留在
 * `useWorkflowStudio` 的编辑核心，核心只从这里读回一个 `draggable`（是否允许拖动节点）。
 * `canvasRef` 同时交回核心，供「在画布中心新增节点」定位用。
 */
export function useCanvasViewport() {
  const flow = useReactFlow()
  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [dragEnabled, setDragEnabled] = useState(true)
  const [panelWidth, setPanelWidth] = useState(420)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return

    const update = () => {
      const nextWidth = element.clientWidth
      // 高度由 flex 容器决定，这里只记录宽度供节点面板限制拖动范围。
      setCanvasWidth(current => current === nextWidth ? current : nextWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const hasFitViewRef = useRef(false)
  useEffect(() => {
    if (hasFitViewRef.current) return
    const frame = requestAnimationFrame(() => {
      hasFitViewRef.current = true
      void flow.fitView(WORKFLOW_FIT_VIEW_OPTIONS)
    })
    return () => cancelAnimationFrame(frame)
  }, [flow])

  const toggleDrag = useCallback(() => setDragEnabled(value => !value), [])
  const fitView = useCallback(() => void flow.fitView(WORKFLOW_FIT_VIEW_OPTIONS), [flow])

  const draggable = dragEnabled && dockMode === 'select'

  return {
    canvasRef,
    canvasWidth,
    dockMode,
    setDockMode,
    dragEnabled,
    toggleDrag,
    panelWidth,
    setPanelWidth,
    draggable,
    fitView,
  }
}
