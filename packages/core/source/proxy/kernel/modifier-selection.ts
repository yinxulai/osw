import type { Modifier, ModifierContext, ModifierFrameMode, ModifierScope } from '@server/proxy/contracts'
import { bodyDeliveryShape } from '@server/proxy/contracts'

/**
 * 修改器的**结构性筛选**：方向一致、粒度一致、`scope` 覆盖本次交换的形态，按 `order` 升序
 * （同值保持注册顺序）。
 *
 * 与 `match` 的分工是刻意的：结构性条件只取决于这次交换的形态（客户端协议、客户端跳的传输形态），
 * **不取决于上游回了什么**，因此可以在上游回话之前一次算完；
 * `match` 可能依赖 `upstreamHead`（例如「收到头帧之后才介入」），所以在每一帧上现算。
 *
 * 两者一旦混在一起，筛选结果就会随「头帧到了没有」而变，管道就得重筛一次。声明 `scope` 之后，
 * 「这种形态下根本没有它能做的事」由数据表达，修改器自己不必再去判断这两根轴，
 * 也就不会有人忘了判断或判错。
 */
export function selectCandidates(modifiers: readonly Modifier[], context: ModifierContext, frameMode: ModifierFrameMode): readonly Modifier[] {
  return modifiers
    .filter(modifier => modifier.direction === context.direction
      && modifier.frameMode === frameMode
      && matchesModifierScope(modifier.scope, context))
    .slice()
    .sort((left, right) => left.order - right.order)
}

/**
 * 修改器声明的 `scope` 是否覆盖这次交换。省略的范围即「不限」。
 *
 * 判据只取**客户端跳**：上游跳的形态是规划器的决策，修改器对它没有发言权
 * （见 `docs/product/proxy-engine.md` §2.3.1）。
 */
export function matchesModifierScope(scope: ModifierScope | undefined, context: ModifierContext): boolean {
  if (!scope) return true
  if (scope.transports && !scope.transports.includes(context.exchange.transport)) return false
  if (scope.shapes && !scope.shapes.includes(bodyDeliveryShape(context.exchange.transport))) return false
  return true
}
