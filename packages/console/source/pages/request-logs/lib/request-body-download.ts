/**
 * 把采集到的请求体存成一个文件。
 *
 * 用户要的是「完整请求体」——不是给人看的摘要，所以这里**不做任何裁剪**：
 * 能按 JSON 解析就重排成两格缩进（只是排版变化，内容一字不改），
 * 解析不了就原样落盘，绝不把非 JSON 的正文（SSE、纯文本、二进制乱码）丢掉。
 *
 * 文件名带上请求方法，是因为同一个会话里会有大量 `POST /v1/messages`：
 * 只用 ID 命名的话，下载下来的一堆文件在磁盘上看不出谁是谁。
 */

/** 文件名里不能出现的字符（Windows 的保留字符集是其中最严的一份）。 */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\s]+/g

export interface RequestBodyDownload {
  /** 建议的文件名，含扩展名。 */
  name: string
  /** 落盘内容。 */
  text: string
}

/** 请求体按 JSON 重排；解析不了就原样返回。 */
export function prettyRequestBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed || !/^[[{]/.test(trimmed)) return body
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return body
  }
}

export function requestBodyFileName(requestId: string, method: string): string {
  const safeId = requestId.replace(UNSAFE_FILENAME_CHARS, '-').replace(/^-+|-+$/g, '') || 'request'
  const safeMethod = method.replace(UNSAFE_FILENAME_CHARS, '').toUpperCase() || 'REQ'
  return `${safeMethod}-${safeId}.json`
}

export interface RequestBodyDownloadInput {
  requestId: string
  method: string
  body: string | null
}

/**
 * 「下载完整请求体」的产物；没有正文时返回 `null`（调用方据此禁用菜单项）。
 *
 * 判定用 `body === null || body === ''`：空串是真的没采到内容，
 * 而不是「内容是空对象」——后者至少会是 `{}` 两个字符。
 */
export function requestBodyDownload(input: RequestBodyDownloadInput): RequestBodyDownload | null {
  if (input.body === null || input.body === '') return null
  return {
    name: requestBodyFileName(input.requestId, input.method),
    text: prettyRequestBody(input.body),
  }
}

/** 触发浏览器下载。用临时 `<a>` + object URL：不依赖服务端，也不留常驻节点。 */
export function saveTextFile(file: RequestBodyDownload): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  anchor.click()
  // 立刻回收会让部分浏览器来不及取到内容（Chromium 在下一帧才真正读取），
  // 因此挪到宏任务里；延时短到用户不会察觉。
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
