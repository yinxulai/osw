import { ReceiptPaperDecorations, ReceiptSlotDecorations } from './decorations'
import { ReceiptPrinterMachine } from './machine'
import { ReceiptPaper } from './paper'

export type ReceiptPrinterStaticProps = {
  children: React.ReactNode
  statusLabel: string
}

/**
 * 打印机 + 账单的**静态完成态**：不裁剪、不限制高度、不动画。
 *
 * 存在的唯一理由是导出：屏幕上的 `ReceiptPrinterPreview` 为了做出纸卷在槽口里滑动的效果，
 * 外层是「满屏高 + `overflow-hidden`」，账单比视口长时下半截会被直接裁掉。
 * 导出的图不能继承这套裁剪，所以这里重新搭一遍同样的视觉结构，
 * 但让纸的高度由内容决定，并且不再包任何限制高度的盒子。
 * 装饰层与预览共用 `decorations.tsx`，两边不会各自漂移。
 */
export function ReceiptPrinterStatic(params: ReceiptPrinterStaticProps) {
  return (
    <div className="relative flex w-full flex-col items-center">
      <div className="relative z-30 w-full">
        <ReceiptPrinterMachine isComplete shouldMove={false} stage="complete" statusLabel={params.statusLabel} />
      </div>

      <div className="relative z-50 -mt-4 w-[calc(88%+3.25rem)] max-w-full px-5">
        <ReceiptSlotDecorations showLip />
        <div className="relative z-10 mt-px isolate">
          <ReceiptPaperDecorations />
          <ReceiptPaper pulledPx={0}>{params.children}</ReceiptPaper>
        </div>
      </div>
    </div>
  )
}
