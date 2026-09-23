import { cacheHitRate } from '@common/metrics'
import type { ModelStat } from '@common/schemas'
import type { BillRow } from '../components/bill-content'

/** 合并途中的累计量：`BillRow` 只留得下算完的两个派生值。 */
type MergedBillModel = {
  name: string
  success: number
  outputTokens: number
  inputTokens: number
  cachedInputTokens: number
}

/**
 * 账单明细行：把**同名模型**跨供应商合并成一行。
 *
 * 账单的明细行只有模型名、用量、命中率三列，没有「哪一个供应商」这一列——它不是排行榜，
 * 是给外人看的一张收据。同一家上游模型往往被接进来好几份（几个供应商都提供同一个模型名），
 * 名下的用量各算各的，账单上就会出现两行一模一样的名字，被读成「这里有两笔不同的消费」。
 * 排行榜（`ModelRanking`）不合并：那一列本来就写着供应商，拆开才有意义。
 *
 * 合并键取 `providerModelName` 而不是 `providerModelId`：后者是 ProviderModel 配置实体的 id，
 * 同一家模型在两份配置里必然不同，用它当键等于没合并。反过来，不同供应商给同一个模型写
 * 不同显示名的情形（`gpt-5` 与 `openai/gpt-5`）不在这里归一——名字是用户自己配的，
 * 猜测它们是不是同一个模型只会让账单上的名字变得不可预期。
 *
 * 合并后的用量与命中率都由**原始合计**重算，不用各项的平均值加权：合计可以直接相加，
 * 而平均值乘调用数会因为四舍五入在明细行上凑不出总数；命中率则必须用「缓存输入 ÷ 输入」
 * 的分子分母重新相除，否则算的是「各供应商命中率的算术平均」，与顶部那一行的口径不同源。
 */
export function buildBillRows(models: readonly ModelStat[], limit: number): BillRow[] {
  const merged = new Map<string, MergedBillModel>()

  for (const model of models) {
    const existing = merged.get(model.providerModelName)
    if (existing) {
      existing.success += model.success
      existing.outputTokens += model.outputTokens
      existing.inputTokens += model.inputTokens
      existing.cachedInputTokens += model.cachedInputTokens
      continue
    }
    merged.set(model.providerModelName, {
      name: model.providerModelName,
      success: model.success,
      outputTokens: model.outputTokens,
      inputTokens: model.inputTokens,
      cachedInputTokens: model.cachedInputTokens,
    })
  }

  return [...merged.values()]
    // 用量相同的按名字排：同一份数据两次打开账单不该自己换顺序。
    .sort((a, b) => b.outputTokens - a.outputTokens || (a.name < b.name ? -1 : 1))
    .slice(0, limit)
    .map(item => ({
      id: item.name,
      name: item.name,
      // 一次成功调用都没有时写 `—` 而不是 0：那是「没测到」，与「测得 0 个 Token」不同。
      usageTokens: item.success > 0 ? item.outputTokens : null,
      cacheHitRate: cacheHitRate(item.cachedInputTokens, item.inputTokens),
    }))
}
