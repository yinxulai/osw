/**
 * 日志。**这条链路上唯一的规矩是「一行是一条」。**
 *
 * 单独一个文件，是因为有两条规则要被两个地方同时遵守：`index.ts`（收报文那一侧）与
 * `sink.ts`（转发那一侧）。写进各自文件里就会漂成两份，而其中一份迟早会忘掉「外面进来的
 * 文本要先洗一遍」——那正是这里唯一真正重要的规则。
 *
 * ## 洗什么
 *
 * 请求里的文本（路径、`Content-Type`、下游的报错正文）长度由**对方**决定，内容也由对方
 * 决定。直接拼进日志行有两个后果：
 *
 * - 一段带换行的路径能在日志里**伪造出一行并不存在的记录**——日志是按行读的；
 * - 一段足够长的路径是一个不用鉴权就能把日志撑大的口子。
 *
 * 所以凡是从外面进来的字符串都过 `oneLine`：控制字符压成空格、首尾去白、超长截断。
 *
 * ## 记什么
 *
 * 只记「这次请求怎么了」，**不记「谁在发」**：没有安装标识、没有来源地址、没有报文正文。
 * 这一条不是洁癖，是 `index.ts` 文件头那段隐私账的下半段——那几项正好就是这条链路上仅有的、
 * 能被用来识别一个人的东西。
 *
 * ## 成功为什么不记
 *
 * 上报是批量、周期性的：成功行会按「安装数 × 频率」增长，而它回答不了任何问题（「有没有
 * 上报进来」要看下游报表，或临时 `wrangler tail`）。失败行相反——它本来就该是稀疏的，
 * 稀疏到每一条都值得有人看一眼。
 */

/** 一个字段最多留多少个字符。够放完一条路径、一个 MIME 类型、或下游的一句抱怨。 */
const FIELD_MAX_LENGTH = 120

/**
 * 来自外面的文本 → 能放进日志行的一小段。
 *
 * 连续的控制字符（含 `\n` / `\r` / `\t`）压成**一个**空格而不是删掉：删掉会把两段本不相连的
 * 文本粘成一个看起来正常的词，而压成空格至少保留了「这里原本断开过」这个事实。
 */
export function oneLine(value: string, maxLength = FIELD_MAX_LENGTH): string {
  const flattened = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return flattened.length <= maxLength ? flattened : `${flattened.slice(0, maxLength)}…`
}

/**
 * 记一行「这次请求为什么没成」。**每个非 2xx 出口都要经过这里。**
 *
 * 位置固定、字段固定（`status` 与 `error` 一定在，且 `error` 就是响应正文里那个错误码），
 * 于是日志能直接按 `error=not_configured` 过滤、按 `status=500` 计数，而不必去猜每一条自由
 * 文本的形状。`details` 是给人看的补充，值为 `null` 表示「这一项没有」，整项不输出——比打出
 * 一个 `detail=null` 更接近「它没说话」这个事实。
 *
 * 4xx 用 `warn`、5xx 用 `error`：前者是调用方要修的，后者是要人来看的。混成一级就等于让
 * 「今天有没有真的出事」需要人工读一遍。
 *
 * 之所以是「一行」而不是「一段」：Cloudflare 的日志视图与 `wrangler tail` 都是按行滚的，
 * 多行输出在这两处会被拆散、被交错，读起来反而比一行更长更费劲。
 */
export function logOutcome(status: number, error: string, details: Record<string, string | number | null> = {}): void {
  const fields = Object.entries(details).flatMap(([key, value]) =>
    value === null ? [] : [`${key}=${typeof value === 'number' ? value : oneLine(value)}`])
  const line = ['[apis]', `status=${status}`, `error=${error}`, ...fields].join(' ')

  if (status >= 500) console.error(line)
  else console.warn(line)
}
