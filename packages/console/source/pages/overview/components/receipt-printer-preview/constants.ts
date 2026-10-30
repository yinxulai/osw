import { receiptPixelsPerMeter } from '../../lib/receipt-metrics'

/** 出纸口到印刷内容之间的空白纸条高度。 */
export const receiptLeaderBaseHeight = 36
/** 彩蛋门槛：纸条没拉满 50 米就别想看到它。 */
export const receiptEggMinMeters = 50
/** 门槛换算成像素。 */
export const receiptEggMinPx = receiptEggMinMeters * receiptPixelsPerMeter
/**
 * 彩蛋的落点：出纸口正下方一点，也就是账单内容本来开始的位置。
 *
 * 不能钉在「距 LEADER 底边多少」或者「距 50 米刻度多少」上——可见区域永远是纸条的**顶段**
 * （纸条顶端一直贴在出纸口，往下拉是在顶端续空白），钉在深处的元素一辈子也露不出来。
 * 钉在出纸口下面则刚好相反：一到门槛就正好印在机器口上，再往下拉也只是在它下面续空白，
 * 所以彩蛋一旦出现就不会再跑掉。
 */
export const receiptEggTop = receiptLeaderBaseHeight
/** 过了门槛才渲染彩蛋。 */
export function shouldShowReceiptEgg(pulledPx: number) {
  return pulledPx >= receiptEggMinPx
}

export const printingTransformKeyframes = [
  'translateY(calc(-100% + 2px))',
  'translateY(-91%)',
  'translateY(-91%)',
  'translateY(-81%)',
  'translateY(-81%)',
  'translateY(-70%)',
  'translateY(-70%)',
  'translateY(-58%)',
  'translateY(-58%)',
  'translateY(-45%)',
  'translateY(-45%)',
  'translateY(-32%)',
  'translateY(-32%)',
  'translateY(-20%)',
  'translateY(-20%)',
  'translateY(-12%)',
  'translateY(-12%)',
  'translateY(-8%)',
  'translateY(-8%)',
  'translateY(0%)',
]

export const printingKeyframeTimes = [
  0,
  0.075,
  0.105,
  0.18,
  0.21,
  0.285,
  0.315,
  0.39,
  0.42,
  0.495,
  0.525,
  0.6,
  0.63,
  0.705,
  0.735,
  0.81,
  0.84,
  0.915,
  0.945,
  1,
]

const receiptToothCount = 40
const receiptToothDepth = 4
const receiptToothPoints = Array.from(
  { length: receiptToothCount * 2 },
  (_, index) => {
    const x = 100 - ((index + 1) * 100) / (receiptToothCount * 2)
    const y = index % 2 === 0 ? '100%' : `calc(100% - ${receiptToothDepth}px)`
    return `${x}% ${y}`
  },
).join(', ')

export const receiptClipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${receiptToothDepth}px), ${receiptToothPoints})`
