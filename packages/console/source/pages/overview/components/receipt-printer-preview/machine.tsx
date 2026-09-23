import { AnimatePresence, motion } from 'motion/react'
import { Printer } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReceiptPrinterMachineProps } from './types'

type ReceiptMachineStatusDotProps = {
  /** 出纸完成时亮绿灯；出纸途中是呼吸的中性点。 */
  isComplete: boolean
}

/**
 * 机身上那盏状态灯。
 *
 * 辉光用「半透明实心圆 + 实心点」叠出来，不用 `shadow-*`：导出的 PNG 靠 `html-to-image`
 * 克隆 DOM，盒子阴影在深色底上也看不见，叠一个半透明圆更便宜也更稳。
 */
function ReceiptMachineStatusDot(params: ReceiptMachineStatusDotProps) {
  const { isComplete } = params

  return (
    <span aria-hidden="true" className="relative grid size-3.5 shrink-0 place-items-center">
      <span className={cn('absolute inset-0 rounded-full', isComplete ? 'bg-[#3ddc84]/18' : 'bg-white/10')} />
      <span className={cn('size-1.5 rounded-full', isComplete ? 'bg-[#3ddc84]' : 'bg-white/45 motion-safe:animate-pulse')} />
    </span>
  )
}

export function ReceiptPrinterMachine(params: ReceiptPrinterMachineProps) {
  const { isComplete, shouldMove, stage, statusLabel } = params

  return (
    <div className="relative z-40 w-full [--printer-radius:1.5rem]">
      <div className="relative isolate overflow-hidden rounded-(--printer-radius) border border-white/10 bg-[linear-gradient(180deg,#3e4450_0%,#323842_54%,#242932_100%)] px-5 pt-4 pb-9">
        {/* 机身左上角那团柔光、顶部倒角的高光。都写成真元素而不是 `before:`：
            `html-to-image` 不克隆伪元素，导出的 PNG 会静默少掉这层质感。 */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-[radial-gradient(120%_80%_at_18%_0%,rgba(255,255,255,0.1),transparent_62%)]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-0 z-0 h-px bg-white/12" />

        <div className="relative z-10 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Printer size={13} strokeWidth={1.75} className="text-white/45" />
            <span className="font-semibold text-2xs text-white/55 uppercase tracking-[0.22em]">OSW</span>
          </span>
          <ReceiptMachineStatusDot isComplete={isComplete} />
        </div>

        {/* 状态读数走「一根发丝线中间断开、嵌一行小字」的排版，和机身同族的扁平语言；
            机身那片屏幕凹槽已经去掉，换成这一行更安静。 */}
        <div className="relative z-10 mt-5 flex items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-white/8" />
          <span aria-live="polite" className="grid place-items-center" role="status">
            <AnimatePresence initial={false} mode="sync">
              <motion.span
                key={stage}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                initial={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'translateY(3px)' : 'translateY(0px)' }}
                exit={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'translateY(-3px)' : 'translateY(0px)' }}
                transition={{ duration: shouldMove ? 0.18 : 0, ease: [0.23, 1, 0.32, 1] }}
                className="col-start-1 row-start-1 font-medium text-2xs text-white/50 uppercase tracking-[0.18em] whitespace-nowrap"
              >
                {statusLabel}
              </motion.span>
            </AnimatePresence>
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-white/8" />
        </div>
      </div>

      {/* 出纸口：机身底边那道黑色胶囊。纸条从它中间钻出来，所以它得压在纸的上面（`z-50`）。 */}
      <div aria-hidden="true" className="absolute inset-x-4 bottom-2.5 z-50 h-3.5 rounded-full border border-black/50 bg-[#0a0c10]" />
    </div>
  )
}
