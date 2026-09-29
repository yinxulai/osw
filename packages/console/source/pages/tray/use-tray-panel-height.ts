import { useEffect, type RefObject } from 'react'

/**
 * 把面板内容高度报给宿主窗口。
 *
 * 托盘面板是「内容决定高度」的浮层：外面那圈透明留白要恰好等于 CSS 阴影的余量，多一像素
 * 就在桌面别的东西上留下一条缝。所以高度的真相在 DOM 里，窗口跟着它走。
 *
 * 用 `ResizeObserver` 盯住卡片本体，而不是在数据变化后手动量一次：数据、语言、字体加载、
 * 系统缩放……任何一项都能改变高度，能改变高度的东西太多，逐个记住去触发一次测量必然会漏。
 */
export function useTrayPanelHeight(panelRef: RefObject<HTMLElement | null>, verticalGutter: number): void {
  useEffect(() => {
    const element = panelRef.current
    // 浏览器形态下没有宿主可报，静默跳过：面板页只在 Electron 托盘窗口里出现。
    const resize = window.trayPanel?.resize
    if (!element || !resize) return

    let reported = 0
    let frame: number | null = null

    const report = () => {
      frame = null
      const height = Math.ceil(element.getBoundingClientRect().height + verticalGutter)
      if (height === reported) return
      reported = height
      resize(height)
    }

    // 同一帧里可能连来多次回调（子元素一起变化），合并成一次测量与一次 IPC。
    const observer = new ResizeObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(report)
    })
    observer.observe(element)

    // 首帧先报一次：窗口的初始高度与内容的初始高度几乎不可能正好相等。
    report()

    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [panelRef, verticalGutter])
}
