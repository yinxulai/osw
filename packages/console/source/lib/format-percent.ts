/**
 * 百分比：固定一位小数。
 *
 * 账单、命中率、成功率共用同一口径，散在各处的 `${(x * 100).toFixed(1)}%` 会先漂成不同的
 * 小数位。调用方负责把 `null` 换掉（写 '—'），本函数只处理数字。
 *
 * 命中率既出现在总览页与供应商下钻（那边从 `pages/overview/lib/format` 转出，路径不变），
 * 也出现在请求详情那排指标格里——同一个比率在两页写成不同小数位，就是两个数。
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
