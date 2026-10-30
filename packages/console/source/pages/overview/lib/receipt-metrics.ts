/**
 * 小票纸条的纯几何：偏移夹取、平移量、长度换算。
 *
 * 这些是零 React 的物理常量与算术，渲染层（`components/receipt-printer-preview`）与交互控制器
 * （`./bill-receipt`）共用同一份，避免「拉到哪算到头」这类边界在两处各写一遍、各漂一半。
 */

/** 负值是「往机器里塞回去」（把小票卷进机器），-260 是常规上限。 */
export const receiptOffsetMin = -260
/** 纸条刻度：100px 记作 1 米，只用来把「拉了多少」印在纸上。 */
export const receiptPixelsPerMeter = 100
/**
 * 彩蛋：可以一直往下拉。上限只是防呆——DOM 高度按这个值生长，正常拉出彩蛋远远用不到。
 */
export const receiptPullMax = 6000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 偏移量：负 = 把纸条卷回机器（到 `receiptOffsetMin` 为止），
 * 正 = 继续往下拉，纸条顶端续出空白（到 `receiptPullMax` 为止）。
 */
export function clampReceiptOffset(offset: number) {
  return clamp(offset, receiptOffsetMin, receiptPullMax)
}

/**
 * 小票的平移量。只有「往机器里塞」才需要平移纸条本身；
 * 往下拉（正值）不但不平移，还要把纸条顶端的空白续长（见 `root.tsx`），
 * 否则纸条会和出纸口脱开一道缝。
 */
export function clampReceiptTranslate(offset: number) {
  return clamp(offset, receiptOffsetMin, 0)
}

/** 已经拉出来的纸条长度（米），直接给「拉了多少」的进度文案用。 */
export function receiptMeters(offset: number) {
  return Math.max(0, offset) / receiptPixelsPerMeter
}
