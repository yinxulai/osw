import { useReducedMotion } from 'motion/react'
import { ReceiptPrinterMachine } from './machine'
import { ReceiptOutput } from './output'
import { ReceiptPaper } from './paper'
import type { ReceiptPrinterPreviewProps } from './types'
import { clampReceiptOffset, clampReceiptTranslate } from './utils'

export function ReceiptPrinterPreview(params: ReceiptPrinterPreviewProps) {
  const {
    children,
    stage,
    statusLabel,
    receiptOffsetY,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    dragging,
  } = params

  const shouldReduceMotion = useReducedMotion()
  const shouldMove = !shouldReduceMotion
  const isReceiptVisible = stage !== 'processing'
  const isComplete = stage === 'complete'
  const offset = clampReceiptOffset(receiptOffsetY)
  // 往下拉（正偏移）不平移纸条，而是让纸条顶端的空白 LEADER 续长；往机器里塞才平移。
  const pulledPx = Math.max(0, offset)
  const receiptTranslateY = clampReceiptTranslate(offset)

  return (
    <section className="receipt-printer-theme relative isolate flex h-full w-full max-w-120 select-none flex-col items-center" aria-label="Receipt printer" data-stage={stage}>
      <div className="relative z-30 w-full">
        <ReceiptPrinterMachine isComplete={isComplete} shouldMove={shouldMove} stage={stage} statusLabel={statusLabel} />
      </div>

      <ReceiptOutput
        stage={stage}
        dragging={dragging}
        isReceiptVisible={isReceiptVisible}
        receiptTranslateY={receiptTranslateY}
        shouldMove={shouldMove}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <ReceiptPaper pulledPx={pulledPx}>{children}</ReceiptPaper>
      </ReceiptOutput>
    </section>
  )
}
