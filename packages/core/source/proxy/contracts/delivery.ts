/**
 * 一次尝试的交付决策。
 *
 * 决策只有三种合法状态：尚未收到响应头、允许交付、放弃交付。把状态写成判别联合而不是
 * 两个独立布尔值，避免出现「不可交付但仍标记成功」这类无法解释的组合。
 */
export type DeliveryDecision =
  | { readonly kind: 'pending' }
  | { readonly kind: 'deliver', readonly successful: boolean }
  | { readonly kind: 'discard', readonly reason: 'status' | 'transport-mismatch' }

/** 修改器在响应头到达后读取、执行器在同一个对象上写入的决策槽。 */
export interface DeliveryDecisionRef {
  decision: DeliveryDecision
}

export function createDeliveryDecisionRef(): DeliveryDecisionRef {
  return { decision: { kind: 'pending' } }
}
