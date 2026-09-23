import { cn } from '@/lib/utils'
import { BILL_BACKDROP_ICON_URLS } from '../lib/bill-backdrop-icons'
import { ReceiptPrinterStatic } from './receipt-printer-preview'

/** 底板宽度固定：导出图不跟随窗口尺寸，否则同一份账单在不同窗口下导出的图会不一样宽。 */
const SCENE_WIDTH = 520
const BACKDROP_COLUMNS = 3
const BACKDROP_ROWS = 4

/**
 * 图标在底板上的落点。
 *
 * 位置全部由下标推导，**不用 `Math.random()`**：同一份账单每次导出必须长得一模一样，
 * 随机散点会让「重新下载一次」得到一张不同的图。抖动是几个互质乘数取模，
 * 够散但完全可复现。
 */
function backdropSlot(index: number) {
  const column = index % BACKDROP_COLUMNS
  const row = Math.floor(index / BACKDROP_COLUMNS) % BACKDROP_ROWS
  const jitterX = ((index * 37) % 13) - 6
  const jitterY = ((index * 53) % 11) - 5

  return {
    left: `${((column + 0.5) / BACKDROP_COLUMNS) * 100 + jitterX}%`,
    top: `${((row + 0.5) / BACKDROP_ROWS) * 100 + jitterY}%`,
    transform: `translate(-50%, -50%) rotate(${((index * 29) % 41) - 20}deg)`,
  }
}

export type BillExportSceneProps = {
  children: React.ReactNode
  statusLabel: string
  className?: string
}

/**
 * **导出专用的渲染场景**，只在离屏容器里挂载，不参与正常视图的布局与视觉。
 *
 * 它解决两件事：
 * 1. 完整性。屏幕上的打印机为了让纸卷在槽口里滑动，外层是满屏高 + `overflow-hidden`，
 *    账单比视口长时下半截会被裁掉；这里用 `ReceiptPrinterStatic`，高度由内容决定。
 * 2. 画面。底板是深色半透明渐变（不是实色块，导出的 PNG 带 alpha，贴到任何底色上都能融），
 *    下面压一层全部厂商图标做强高斯模糊，作为低对比度的背景肌理。
 */
export function BillExportScene(props: BillExportSceneProps) {
  return (
    <div
      className={cn('relative isolate overflow-hidden rounded-[24px]', props.className)}
      style={{ width: SCENE_WIDTH }}
    >
      {/* 深色半透明底板：导出图保留 alpha，底色交给使用方。 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(158deg,rgba(13,18,26,0.74)_0%,rgba(24,32,45,0.62)_44%,rgba(9,13,19,0.78)_100%)]"
      />

      {/* 全部厂商图标 + 高斯模糊：只做肌理，不抢账单。 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-50 blur-[30px]">
        {BILL_BACKDROP_ICON_URLS.map((url, index) => (
          <img
            key={url}
            src={url}
            alt=""
            draggable={false}
            className="absolute"
            style={{
              ...backdropSlot(index),
              width: index % 3 === 1 ? 116 : 88,
              height: index % 3 === 1 ? 116 : 88,
            }}
          />
        ))}
      </div>

      {/* 左上角冷光与底部压暗：给模糊层一点方向感，避免整块糊成平均色。 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_18%_0%,rgba(120,160,255,0.16)_0%,transparent_62%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_58%,rgba(0,0,0,0.4)_100%)]" />

      <div className="relative z-10 px-5 pt-9 pb-12">
        <ReceiptPrinterStatic statusLabel={props.statusLabel}>{props.children}</ReceiptPrinterStatic>
      </div>
    </div>
  )
}
