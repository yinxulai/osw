import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/provider'
import type { useBillReceipt } from '../hooks/use-bill-receipt'
import { BillContent, type BillContentProps } from './bill-content'
import { BillExportScene } from './bill-export-scene'
import { ReceiptControls, ReceiptPullHint } from './receipt-controls'
import { ReceiptPrinterPreview, receiptMeters } from './receipt-printer-preview'

type BillReceipt = ReturnType<typeof useBillReceipt>

interface OverviewBillDialogProps {
  open: boolean
  onClose: () => void
  receipt: BillReceipt
  statusLabel: string
  contentProps: BillContentProps
}

/**
 * 整屏账单对话框 + 离屏导出场景。
 *
 * 两份内容共用 `BillContent`，只是宿主不同：屏幕里是打印机的纸，导出时是视口外的静态场景。
 */
export function OverviewBillDialog(props: OverviewBillDialogProps) {
  const { receipt, contentProps } = props
  const t = useTranslation()

  return (
    <>
      <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/28 supports-backdrop-filter:backdrop-blur-md"
          className="top-0! left-0! h-screen! w-screen! max-w-none! translate-x-0! translate-y-0! overflow-hidden! rounded-none! border-0! bg-transparent! p-0! shadow-none!"
        >
          {/* 对话框被铺成整屏、看上去没有标题，但标题必须在：Radix 靠它给弹窗命名，
              否则读屏软件只会念成「对话框」。 */}
          <DialogTitle className="sr-only">{t('overview.bill.title')}</DialogTitle>
          <div className="relative flex h-full w-full items-start justify-center overflow-hidden px-4 pt-4 sm:px-8 sm:pt-6">
            <ReceiptControls
              stage={receipt.stage}
              downloading={receipt.downloading}
              onPrint={receipt.print}
              onDownload={() => void receipt.download()}
              onClose={props.onClose}
            />
            <ReceiptPullHint stage={receipt.stage} touched={receipt.touched} meters={receiptMeters(receipt.offsetY)} />

            <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-1 sm:p-2">
              <div className="relative z-10 flex h-full w-full max-w-140 items-center justify-center overflow-hidden">
                <ReceiptPrinterPreview
                  stage={receipt.stage}
                  statusLabel={props.statusLabel}
                  receiptOffsetY={receipt.offsetY}
                  {...receipt.pointerHandlers}
                  dragging={receipt.dragging}
                >
                  <BillContent {...contentProps} />
                </ReceiptPrinterPreview>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        导出专用的离屏场景：`fixed` 挪到视口外，导出时只按内容高度光栅化，
        既不参与页面布局也不影响对话框里那台打印机的动效。
        `html-to-image` 是把节点序列化进 SVG，位置在视口外完全不影响渲染。
      */}
      {props.open ? (
        <div aria-hidden="true" className="pointer-events-none fixed top-0 left-[-20000px]">
          <div ref={receipt.exportRef}>
            <BillExportScene statusLabel={props.statusLabel}>
              <BillContent {...contentProps} />
            </BillExportScene>
          </div>
        </div>
      ) : null}
    </>
  )
}
