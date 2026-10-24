/**
 * 账单明细行的数据结构。
 *
 * `BillRow` 是 `buildBillRows` 的产出形状，也是 `BillContent` 的输入形状。它声明在
 * 领域层（`lib`）而不是视图里：调用方是纯函数，用它的也是纯函数，只有最后一跳才是
 * 渲染。之前它长在 `components/bill-content.tsx` 里，于是 `lib/bill-models.ts` 反过来
 * 从视图 import 类型——领域层依赖视图，方向是反的。
 */
export type BillRow = {
  id: string
  name: string
  /** 一次成功调用都没有时为 `null`：那是「没测到」，与「测得 0 个 Token」不同。 */
  usageTokens: number | null
  /** 同上；分母为 0 时由 `cacheHitRate` 判空。 */
  cacheHitRate: number | null
}
