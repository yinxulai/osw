/**
 * 诊断配置里的数字项：**唯一的合法化规则**。
 *
 * 输入框允许空、负数、小数、`e` 记法与粘贴进来的任何东西。规则只有两条：不小于下界、
 * 取整。上界故意不给——轮次写多、输入长度补长都是用户自己的选择，界面能做的只是别让
 * 非法值混进配置。原先这条规则是 `ConfigNumberRow` 里的一个箭头函数，现在提出来，因为
 * 「空输入落回下界」是一条能直接断言的行为，不是渲染细节。
 */
export function clampConfigNumber(value: number, min: number): number {
  return Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min)
}
