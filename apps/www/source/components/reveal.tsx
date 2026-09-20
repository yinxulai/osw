import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  /** 进场延迟（毫秒）。同一组卡片用它错开出现，避免整块一起弹。 */
  delay?: number
  className?: string
}

/**
 * 滚动进场包装：元素进入视口后从下方浮入一次，之后不再重放。
 *
 * 隐藏态由 `index.css` 的 `[data-reveal]` 负责，这里只把属性翻成 `shown`。
 * `IntersectionObserver` 不可用时立刻显示——绝不让内容卡在不可见状态。
 */
export function Reveal(params: RevealProps) {
  const { children, delay = 0, className } = params
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.04 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-reveal={shown ? 'shown' : 'pending'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={className}
    >
      {children}
    </div>
  )
}
