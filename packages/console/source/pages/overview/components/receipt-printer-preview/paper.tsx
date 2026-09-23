import { receiptClipPath, receiptEggTop, receiptLeaderBaseHeight, shouldShowReceiptEgg } from './constants'
import { ReceiptEasterEgg } from './easter-egg'
import type { ReceiptPaperProps } from './types'

export function ReceiptPaper(params: ReceiptPaperProps) {
  const { children, pulledPx } = params

  return (
    <article className="relative z-10 min-h-0 bg-[#fffefc] bg-[radial-gradient(circle_at_1px_1px,rgba(16,24,40,0.04)_1px,transparent_0)] bg-size-[8px_8px] px-5 pt-0 pb-4 font-mono text-[#20252f] select-none" style={{ clipPath: receiptClipPath }}>
      {/*
        纸条顶端的空白 LEADER。往下拉时只有它在长（`root.tsx` 不平移纸条），
        所以出纸口那里永远不会裂开一道缝，纸也永远「从机器里出来」。

        彩蛋钉在出纸口下面（`receiptEggTop`），而不是钉在 LEADER 深处：
        可见区域永远只有纸条的顶段，钉在深处的元素一辈子也露不出来。
      */}
      <div className="relative overflow-hidden" style={{ height: `${receiptLeaderBaseHeight + pulledPx}px` }}>
        {shouldShowReceiptEgg(pulledPx) ? (
          <div className="absolute inset-x-0" style={{ top: `${receiptEggTop}px` }}>
            <ReceiptEasterEgg />
          </div>
        ) : null}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(16,24,40,0.35)_0_6px,transparent_6px_12px)] opacity-70" />
      </div>
      <div className="pt-6">
        {children}
      </div>
    </article>
  )
}
