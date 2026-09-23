import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { ProviderIcon } from '../../../model-management/components/provider-icon'
import { cn } from '@/lib/utils'
import type { ReceiptPrinterMachineProps } from './types'

export function ReceiptPrinterMachine(params: ReceiptPrinterMachineProps) {
  const { isComplete, shouldMove, stage, statusLabel } = params

  return (
    <div className="relative z-40 w-full [--printer-inner-radius:calc(var(--printer-radius)-var(--printer-inset))] [--printer-inset:0.625rem] [--printer-radius:1.25rem]">
      <div className="relative isolate overflow-hidden rounded-(--printer-radius) border border-[#253042] bg-[linear-gradient(165deg,#93a0b2_0%,#647185_36%,#465161_63%,#8894a7_100%)] p-(--printer-inset) pb-6">
        {/* 机身网点纹理。写成真元素而不是 `before:`：`html-to-image` 不会克隆伪元素，
            导出的 PNG 里会直接少掉这层质感。 */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.15)_1px,transparent_0)] bg-size-[8px_8px] opacity-45" />
        <div className="relative z-10 flex h-9 items-start justify-between">
          <div className="flex items-center gap-2.5">
            <ProviderIcon name="" size={18} className="rounded-none" />
            <span className="font-medium text-[#f5f7fb] text-xs uppercase tracking-widest">OSW</span>
          </div>
          <span className="font-mono text-[#e7ebf5] text-xs">#{Math.round(Date.now() % 100000).toString().padStart(5, '0')}</span>
        </div>

        <div className="relative z-10 isolate overflow-hidden rounded-(--printer-inner-radius) border border-[#0b1119] bg-[#0f141c] p-3 text-[#ebf0fb]">
          {/* 屏幕凹槽的内阴影，同样不能用 `after:`（见上）。 */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] shadow-[inset_0_0_22px_2px_rgba(0,0,0,0.55)]" />
          <div className="relative z-10 flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="relative grid size-5 shrink-0 place-items-center">
              <AnimatePresence initial={false} mode="sync">
                {isComplete ? (
                  <motion.span
                    key="complete"
                    animate={{ opacity: 1, transform: 'scale(1)' }}
                    initial={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'scale(0.94)' : 'scale(1)' }}
                    exit={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'scale(0.96)' : 'scale(1)' }}
                    transition={{ duration: shouldMove ? 0.16 : 0, ease: [0.23, 1, 0.32, 1] }}
                    className="col-start-1 row-start-1 grid place-items-center text-[#40d486]"
                  >
                    <CheckCircle2 size={18} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="working"
                    animate={{ opacity: 1, transform: 'scale(1)' }}
                    initial={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'scale(0.94)' : 'scale(1)' }}
                    exit={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'scale(0.96)' : 'scale(1)' }}
                    transition={{ duration: shouldMove ? 0.16 : 0, ease: [0.23, 1, 0.32, 1] }}
                    className="col-start-1 row-start-1 grid place-items-center text-[#dce4f6]"
                  >
                    <LoaderCircle size={18} className={cn(shouldMove && 'animate-spin motion-reduce:animate-none')} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <div aria-live="polite" role="status" className="grid min-w-0 flex-1 items-center">
              <AnimatePresence initial={false} mode="sync">
                <motion.div
                  key={stage}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  initial={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'translateY(4px)' : 'translateY(0px)' }}
                  exit={{ opacity: shouldMove ? 0 : 1, transform: shouldMove ? 'translateY(-4px)' : 'translateY(0px)' }}
                  transition={{ duration: shouldMove ? 0.18 : 0, ease: [0.23, 1, 0.32, 1] }}
                  className="col-start-1 row-start-1 truncate font-medium text-[#dce4f6] text-xs leading-none"
                >
                  {statusLabel}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="absolute inset-x-5 bottom-2 z-50 h-2 rounded-md border border-[#0b1119] bg-[#0f141c]" />
    </div>
  )
}
