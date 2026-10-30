import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent, WheelEvent } from 'react'
import type { AnalyticsRange } from '@common/schemas'
import { BillReceipt } from '../lib/bill-receipt'

interface UseBillReceiptOptions {
  /** 账单对话框是否打开：打开即重走一遍出票时序，关闭即把纸条归位。 */
  open: boolean
  /** 当前分析范围，仅用于给导出的 PNG 命名。 */
  range: AnalyticsRange
}

/**
 * 渲染层与 {@link BillReceipt} 之间的**薄绑定**——这里没有业务逻辑。
 *
 * 状态机、时序、位移、二维码、导出都在 `../lib/bill-receipt`（普通类、零 React、可脱离渲染单测）。
 * 这个 hook 只做三件 React 专属的事：
 * 1. 用 `useSyncExternalStore` 把控制器状态订阅进渲染；
 * 2. 用两个 effect 把「开合 / 卸载」接到控制器的生命周期；
 * 3. 把 DOM 指针 / 滚轮事件翻译成控制器调用（指针捕获是 DOM 行为，留在这一层）。
 */
export function useBillReceipt(options: UseBillReceiptOptions) {
  const { open, range } = options
  const [controller] = useState(() => new BillReceipt())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const exportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void controller.loadQr()
    return () => controller.dispose()
  }, [controller])

  useEffect(() => {
    if (open) controller.print()
    else controller.reset()
    return controller.clearTimers
  }, [open, controller])

  const pointerHandlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (controller.beginDrag(event.clientY)) event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => controller.moveDrag(event.clientY),
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      controller.endDrag()
    },
    onWheel: (event: WheelEvent<HTMLDivElement>) => {
      if (!controller.wheel(event.deltaY)) return
      event.preventDefault()
      event.stopPropagation()
    },
  }

  return {
    stage: state.stage,
    offsetY: state.offsetY,
    touched: state.touched,
    dragging: state.dragging,
    downloading: state.downloading,
    qrDataUrl: state.qrDataUrl,
    printedAt: state.printedAt,
    exportRef,
    print: controller.print,
    download: () => controller.download(exportRef.current, range),
    pointerHandlers,
  }
}
