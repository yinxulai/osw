export type ReceiptPrinterStage = 'processing' | 'printing' | 'complete'

export type ReceiptPrinterPreviewProps = {
  children: React.ReactNode
  stage: ReceiptPrinterStage
  statusLabel: string
  receiptOffsetY: number
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  dragging: boolean
}

export type ReceiptMotionHandlers = Pick<
  ReceiptPrinterPreviewProps,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onWheel'
>

export type ReceiptPrinterMachineProps = {
  isComplete: boolean
  shouldMove: boolean
  stage: ReceiptPrinterStage
  statusLabel: string
}

export type ReceiptPaperProps = {
  children: React.ReactNode
  /** 往下拉出来的空白长度（px）：> 0 时纸条顶端会跟着续长，满 50 米后才可能露出彩蛋。 */
  pulledPx: number
}

export type ReceiptOutputProps = {
  children: React.ReactNode
  stage: ReceiptPrinterStage
  dragging: boolean
  isReceiptVisible: boolean
  receiptTranslateY: number
  shouldMove: boolean
} & ReceiptMotionHandlers
