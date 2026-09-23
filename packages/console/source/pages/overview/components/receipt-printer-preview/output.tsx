import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { printingKeyframeTimes, printingTransformKeyframes } from './constants'
import { ReceiptPaperDecorations, ReceiptSlotDecorations } from './decorations'
import type { ReceiptOutputProps } from './types'

export function ReceiptOutput(params: ReceiptOutputProps) {
  const {
    children,
    stage,
    dragging,
    isReceiptVisible,
    receiptTranslateY,
    shouldMove,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
  } = params

  return (
    <div className="relative z-50 -mt-4 flex-1 min-h-0 w-[calc(88%+3.25rem)] max-w-full overflow-hidden px-5">
      <ReceiptSlotDecorations showLip={isReceiptVisible} />
      <motion.div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        aria-hidden={stage !== 'complete'}
        initial={false}
        animate={{
          opacity: isReceiptVisible ? 1 : 0,
          transform: stage === 'printing' && shouldMove
            ? printingTransformKeyframes
            : stage === 'complete'
              ? `translateY(${receiptTranslateY}px)`
              : isReceiptVisible || !shouldMove
                ? 'translateY(0%)'
                : 'translateY(calc(-100% + 2px))',
        }}
        transition={{
          opacity: { duration: shouldMove ? 0.16 : 0, ease: [0.23, 1, 0.32, 1] },
          transform: {
            duration: shouldMove ? (stage === 'printing' ? 1.75 : 0) : 0,
            ease: stage === 'printing' ? 'linear' : 'easeOut',
            times: shouldMove && stage === 'printing' ? printingKeyframeTimes : undefined,
          },
        }}
        className={cn(
          'relative z-10 mt-px isolate touch-none',
          stage === 'complete' ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
        )}
      >
        <ReceiptPaperDecorations />
        {children}
      </motion.div>
    </div>
  )
}
