/**
 * 一次指针拖拽的生命周期——零 React、零 DOM 耦合（`window` 可注入），可脱离渲染单测。
 *
 * 画布上多处要「按下某个把手，跟着指针走，松开或节点被删时收尾」：便签右下角缩放、
 * 右侧面板拖宽，各自把 `window` 上的 `pointermove`/`pointerup` 挂了一遍，连「中途卸载要
 * 收回监听」这件易漏的事也各写一遍。这里把那套监听 + 收尾（含可选的 rAF 合并）收成一处，
 * 每个把手只留下自己的那点数学（夹取、按 zoom 折算、取一维还是二维）。
 */

export interface PointerPosition {
  x: number
  y: number
}

export interface PointerDragOptions {
  /** 指针移动时回调当前位置。`coalesce` 为真时每帧最多回调一次（取最后位置）。 */
  onMove: (position: PointerPosition) => void
  /** 指针抬起后回调一次（`stop()` 收回时**不**回调）。 */
  onEnd?: () => void
  /** 用 requestAnimationFrame 合并高频移动——拖宽这类每帧只需最后一个值的场景。 */
  coalesce?: boolean
  /** 注入事件源，默认全局 `window`。单测用假实现驱动。 */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  /** 注入 rAF 调度，默认全局 `requestAnimationFrame`/`cancelAnimationFrame`。 */
  schedule?: (callback: () => void) => number
  cancel?: (handle: number) => void
}

export interface PointerDrag {
  /** 收回监听。用于组件在拖拽中途卸载时清理；不触发 `onEnd`。 */
  stop: () => void
}

/**
 * 从当前这一刻起跟踪一段指针拖拽。调用方已经拿到 pointerdown（并做过 preventDefault），
 * 这里只负责挂 `window` 监听、可选地按帧合并、以及在抬起 / 收回时清理干净。
 */
export function startPointerDrag(options: PointerDragOptions): PointerDrag {
  const target = options.target ?? window
  const schedule = options.schedule ?? ((callback: () => void) => requestAnimationFrame(callback))
  const cancel = options.cancel ?? ((handle: number) => cancelAnimationFrame(handle))

  let frame: number | null = null
  let pending: PointerPosition | null = null
  let stopped = false

  const flush = () => {
    frame = null
    if (pending) options.onMove(pending)
  }

  const handleMove = (event: PointerEvent) => {
    const position = { x: event.clientX, y: event.clientY }
    if (!options.coalesce) {
      options.onMove(position)
      return
    }
    pending = position
    if (frame === null) frame = schedule(flush)
  }

  const teardown = () => {
    if (stopped) return
    stopped = true
    if (frame !== null) {
      cancel(frame)
      frame = null
    }
    target.removeEventListener('pointermove', handleMove as EventListener)
    target.removeEventListener('pointerup', handleUp as EventListener)
  }

  function handleUp(): void {
    // 抬起时把最后一帧补发出去，否则合并模式下最末一次移动会被丢掉。
    if (options.coalesce && pending) options.onMove(pending)
    teardown()
    options.onEnd?.()
  }

  target.addEventListener('pointermove', handleMove as EventListener)
  target.addEventListener('pointerup', handleUp as EventListener)

  return { stop: teardown }
}
