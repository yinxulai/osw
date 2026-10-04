/**
 * 规则内容的签名：把一份载荷映射成一个稳定的 `id`。
 *
 * ## 为什么 id 从内容派生，而不是随机
 *
 * 目录的动词是「发布」与「使用」。如果每次发布都生成一个新的随机 id，同一份内容被十个人
 * 各发一遍就会变成十条规则，用量被摊薄成十个「用过几次」，排名也就失去了意义。从内容派生
 * 让「发布」变成幂等的 upsert：同一份内容只存在一条，用量在它身上累加。
 *
 * ## 归一化：为什么先过一遍 schema
 *
 * 同一份规则可以由不同路径到达这里——界面按自己的字段顺序拼出来、内核从一个草稿转出来、
 * 或者一个第三方客户端手工构造。它们在语义上可能完全一样，字节却不一定。所以签名之前先
 * `SharedRewriteRulePayloadSchema.parse` 一次：这会把可选字段补成默认值、把键的顺序收敛成
 * schema 定义的那一份，于是「语义相同」与「签名相同」重合。
 *
 * ## 签名算法
 *
 * `sha256` 作用在**规范化后的 JSON** 上（键按字典序排列），前缀 `sha256:` 标出算法。它与
 * 「一条规则被谁发布过」无关：签的是内容，不是作者——这一点是匿名目录能成立的前提。
 *
 * 用 Web Crypto（`crypto.subtle`）而不是 `node:crypto`：Worker 跑在 V8 isolate 里，没有
 * Node 内置模块（见 `packages/toolkit/scripts/check-package-boundaries.mjs`）。
 */

import { SharedRewriteRulePayloadSchema, type SharedRewriteRulePayload } from '@common/shared-rewrite-rules'

/**
 * 把一个值序列化成**规范形式**：对象的键按字典序排列，数组保持顺序。
 *
 * 数组保序是刻意的：动作的顺序、用例的顺序都是规则语义的一部分，重排它们得到的是另一条规则。
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`
}

/**
 * 算一条规则的签名。
 *
 * 入参是**未经校验**的载荷（`unknown`）：调用方通常刚从 HTTP 正文里解析出它，还没过 schema。
 * 校验在这里发生——签名与校验用的是同一份 schema，所以「能签名的」与「能入库的」是同一集合。
 */
export async function signatureOf(input: unknown): Promise<{ id: string; payload: SharedRewriteRulePayload }> {
  const payload = SharedRewriteRulePayloadSchema.parse(input)
  const canonical = canonicalize(payload)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { id: `sha256:${hex}`, payload }
}

/**
 * 搜索用的归一化文本：名称与说明拼在一起，转小写、折叠空白。
 *
 * 库存的是它，查询也过同一条归一化——于是「大小写不同」「多打了一个空格」不会让一条明明
 * 存在的规则搜不到。它只是 `payload` 的派生视图，响应始终回 `payload` 里那份原文。
 */
export function searchTextOf(payload: SharedRewriteRulePayload): string {
  return `${payload.name} ${payload.description}`.toLowerCase().replace(/\s+/g, ' ').trim()
}
