import type { LogicalModel } from '@common/schemas'

/**
 * 逻辑模型多选框的纯排序 / 过滤——零 React。
 *
 * 排序语义与图里的逻辑模型选择节点一致：**已选在前，且维持勾选顺序（勾选顺序即优先级）**，
 * 其余按 id 排在后面；过滤匹配的是行里看得见的两样——模型 id 与描述。
 */

/** 已选在前（维持 `selectedIds` 的顺序），其余按 modelId 升序。 */
export function orderModelsBySelection(models: readonly LogicalModel[], selectedIds: readonly string[]): LogicalModel[] {
  return [...models].sort((left, right) => {
    const leftIndex = selectedIds.indexOf(left.modelId)
    const rightIndex = selectedIds.indexOf(right.modelId)
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
    if (leftIndex >= 0) return -1
    if (rightIndex >= 0) return 1
    return left.modelId.localeCompare(right.modelId)
  })
}

/** 按关键词过滤（匹配 modelId 或 description）。关键词空白时原样返回。 */
export function filterModelsByKeyword(models: readonly LogicalModel[], keyword: string): LogicalModel[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return [...models]
  return models.filter(model => [model.modelId, model.description].some(field => field.toLowerCase().includes(normalized)))
}
