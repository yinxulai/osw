/**
 * 打印机场景里那些「没有语义、只有质感」的装饰层。
 *
 * 抽出来的原因有两个：
 * 1. 屏幕上的预览（`output.tsx`）和导出用的静态版（`static.tsx`）必须长得一模一样；
 * 2. 这些层**不能写成 `before:`/`after:`** —— `html-to-image` 不克隆伪元素，
 *    写成伪元素的话导出的 PNG 会静默少掉投影、暗边和出纸口压条。
 *    统一放在这里，以后加装饰就只有一处要记这条规矩。
 *
 * 全部 `pointer-events-none` + `aria-hidden`：它们不是内容，也不该接事件。
 */

/**
 * 出纸口上方那道折射出来的暗边。
 *
 * 出纸口本身（那道黑色胶囊）画在机身底边上，见 `machine.tsx`；这里只剩压在纸条顶端的那层暗边。
 */
export type ReceiptSlotDecorationsProps = {
  /** 纸条还没出来时不需要这道暗边。 */
  showLip: boolean
}

export function ReceiptSlotDecorations(params: ReceiptSlotDecorationsProps) {
  return params.showLip ? (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-7 -top-1 z-30 h-2 bg-[#0a0c10]/70 blur-[6px]" />
  ) : null
}

/** 纸条的投影，以及它落在台面上的那团阴影。 */
export function ReceiptPaperDecorations() {
  return (
    <>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-3 bottom-4 z-0 rounded-sm shadow-[0_8px_24px_rgba(16,24,40,0.24)]" />
      <span aria-hidden="true" className="pointer-events-none absolute right-[8%] bottom-0 left-[8%] z-0 h-3 translate-y-1.5 rounded-full bg-[#0f141c]/12 blur-lg" />
    </>
  )
}
