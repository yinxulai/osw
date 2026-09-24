/**
 * 快照里密钥的编解码。
 *
 * 只用 base64，**不做加密**：拿到快照的人一条解码命令就能还原。它的作用是不让密钥以 `sk-…`
 * 的样子直接躺在远端文件里（被肉眼扫到、被密钥扫描器判成泄露），而不是防止别人读取。
 * 这一点在 `docs/product/cloud-sync.md` 的「安全与隐私」里写死了，界面上也一直挂着同一句提醒。
 */

/** 规范的 base64 只可能是这些字符，且长度一定是 4 的倍数。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export function encodeSecret(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

/**
 * 解出一把密钥；解不出来返回 `null`。
 *
 * `Buffer.from(x, 'base64')` 对垃圾输入不抛错——它会静默丢掉不认识的字符再返回半截结果，
 * 所以这里自己先把形状验一遍。宁可当作「这份快照没带这把密钥」（拉取时沿用本机已有的），
 * 也不要把一段乱码写进密钥库：那会让这个供应商在下一次请求时才以一个看不懂的错误爆掉。
 */
export function decodeSecret(encoded: string): string | null {
  if (encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) return null
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  // 空串或含替换字符都说明这串编码本身是坏的——密钥不可能是空的。
  if (decoded.length === 0 || decoded.includes('\uFFFD')) return null
  return decoded
}
