import { Download, MoveVertical, Printer, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { ReceiptPrinterStage } from './receipt-printer-preview'

export type ReceiptControlsProps = {
  stage: ReceiptPrinterStage
  downloading: boolean
  onPrint: () => void
  onDownload: () => void
  onClose: () => void
}

type ControlKeyProps = {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  /** 主操作：白字 + 一层几乎看不出来的玻璃底，让它在纯文字里浮出来。 */
  primary?: boolean
  /** 只有图标、不带文字（关闭）。 */
  iconOnly?: boolean
}

/**
 * 操作条上的一个动作。
 *
 * 刻意做成**纯文字按钮**：这台机器自己（金属渐变、凹槽屏幕、网点纹理）已经把拟物用满了，
 * 旁边再摆一排仿物理键帽只会互相打架。这里只做一件事——把层级压到最低：
 * 次级动作靠字色（60% 白）隐进去，主操作用「全白 + 极淡玻璃底」浮出来，
 * 中间没有任何色块和渐变参与，只靠间距和字重撑着。
 * 图标 14px / 1.75 描边：比默认的 2px 细一档，落在深色玻璃上不会发糊。
 */
function ControlKey(params: ControlKeyProps) {
  const { icon: Icon, label, onClick, disabled, primary, iconOnly } = params

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border text-xs font-medium whitespace-nowrap select-none',
        'transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/35',
        'disabled:pointer-events-none disabled:opacity-35',
        iconOnly ? 'w-8 justify-center' : 'px-3',
        primary
          ? 'border-white/14 bg-white/12 text-white hover:bg-white/20'
          : 'border-transparent text-white/60 hover:bg-white/8 hover:text-white',
      )}
    >
      <Icon size={14} strokeWidth={1.75} />
      {iconOnly ? null : <span>{label}</span>}
    </button>
  )
}

/**
 * 账单场景的操作条。
 *
 * 贴在右下角——票据从机身里往下走，左下到正中都是纸的地盘，只有右下角一直空着。
 *
 * 不跟机身共用「控制台」那一套（深色面板 + 状态灯 + 独立键帽）：那是机器的一部分，
 * 越具体越好；浮在场景之上的操作条越抽象越好。所以这里只有一片**磨砂玻璃胶囊**——
 * 单色半透明底、发丝边、圆角到顶，没有渐变、没有内阴影、没有状态灯。
 * 状态灯是特意删掉的：机身屏幕上那行字本来就在说同一件事，再亮一颗灯只是重复；
 * 「还没印完」这层信息由主键变灰（disabled）表达，已经足够。
 */
export function ReceiptControls(params: ReceiptControlsProps) {
  const { stage, downloading, onPrint, onDownload, onClose } = params
  const t = useTranslation()
  const ready = stage === 'complete'

  return (
    <div className="absolute right-4 bottom-4 z-70 sm:right-6 sm:bottom-6">
      <div className="flex items-center gap-0.5 rounded-full border border-white/12 bg-[#0b0f16]/70 p-1 backdrop-blur-xl">
        <ControlKey icon={Printer} label={t('overview.bill.printAgain')} onClick={onPrint} />
        <ControlKey
          icon={Download}
          label={downloading ? t('overview.bill.downloading') : t('overview.bill.download')}
          onClick={onDownload}
          disabled={!ready || downloading}
          primary
        />
        {/* 关闭跟前两个动作不同类（一个重新进纸、一个出图、一个退场），
            用一道发丝竖线隔开，也省得手滑把「下载」按成「关掉」。 */}
        <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-white/14" />
        <ControlKey icon={X} label={t('overview.bill.close')} onClick={onClose} iconOnly />
      </div>
    </div>
  )
}

export type ReceiptPullHintProps = {
  stage: ReceiptPrinterStage
  /** 纸条被碰过没有：没碰过教怎么卷，碰过就报米数。 */
  touched: boolean
  meters: number
}

/**
 * 纸条底部的读数条。
 *
 * 两层交互都没有可见的抓手，不提示基本没人会发现，所以给一行常驻在底部左下角的灰字：
 * 还没碰过纸条时教你怎么卷动，一开始拉就改成「已拉出多少米」——
 * 拉了 50 米才有的彩蛋，总得让人知道自己离它还有多远。
 * 贴左下角是为了避开居中的纸条和右下角的操作条，材质跟操作条同一套玻璃。
 */
export function ReceiptPullHint(params: ReceiptPullHintProps) {
  const t = useTranslation()
  const visible = params.stage === 'complete'

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute bottom-4 left-4 z-70 flex items-center gap-1.5 text-2xs tracking-wide transition-opacity duration-300 sm:bottom-6 sm:left-6',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <span className="flex items-center gap-1.5 rounded-full border border-white/12 bg-[#0b0f16]/60 px-2.5 py-1 text-white/60 backdrop-blur-md">
        {params.touched
          ? <span className="tabular-nums">{t('overview.bill.pull.meters', { meters: params.meters.toFixed(2) })}</span>
          : <><MoveVertical size={12} />{t('overview.bill.hint.pull')}</>}
      </span>
    </div>
  )
}
