/**
 * 管理 API 的**本次应用启动**凭证。
 *
 * 为什么需要它：管理 API 只监听回环，但「只监听回环」不等于访问控制——本机任意一个网页
 * 都能向 `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以必须有一个真正
 * 只有自家前端才知道的东西（见 issue #76 与 apps/docs/specs/operations/security-privacy.md 的「访问控制」）。
 * 凭证一到位，原来那两道便宜的边界（`Host` 白名单、CORS 来源白名单）就该退场：拿着凭证的
 * 调用方它们挡不住，凭证泄了它们也救不回来，只留下误伤正常的故障。
 *
 * 为什么是「每次启动随机生成」而不是持久化的密钥：
 *
 *   - 不需要任何「生成 / 轮换 / 吊销」的界面与设置项，也不存在「用户把它删了怎么办」；
 *   - 重启即失效，磁盘上永远没有一份长期有效的秘密躺在那里等人去翻；
 *   - 用户永远不用看到或复制它，它只在自家进程之间流转。
 *
 * **它活着的时候会有一份落盘副本，但只活到进程退出。** 校验是**无条件**的：每一条
 * `/api/*` 请求都要带着它（见 `./gateway/access.ts`），所以同用户的 `osw stop` /
 * `osw status` 也必须拿得到——交付通道是数据目录里那个 `0600` 的临时文件，写在下面
 * `./token-file.ts`，退出即删。这不是「一份长期秘密」：内容每次启动都换，磁盘上不会留下
 * 昨天那份还能用的副本，也不需要任何轮换或吊销的界面。
 *
 * 别把它写进 `runtime.json`：那份快照会被 `status --json` 原样打印出去。
 *
 * **谁来生成**：宿主，在应用启动时生成一次（`RuntimeConfig.managementToken`）。
 * 这里只提供生成函数，core 自己**不**调用它：桌面形态的核心服务跑在一个可能崩溃重启的
 * 独立进程里，如果每重启一次就换一份，主进程手里那份立刻作废，渲染层随后的每一次请求
 * 都会 401。所以「一次应用启动」= 一份凭证。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** 凭证请求头。名字带前缀，避免与将来可能出现的其他 `X-*` 头撞在一起。 */
export const MANAGEMENT_TOKEN_HEADER = 'x-osw-token'

/**
 * 生成一份新凭证：32 字节的随机量，base64url 编码（43 个字符，无需转义就能放进头部与
 * JSON 字符串）。
 *
 * 熵够不够不是这里的关键——攻击面是「本机网页猜不出来」而不是「抗离线爆破」，
 * 128 位就已经远超需要；选 32 字节只是因为它在任何编码里都不会引入格式麻烦。
 *
 * **调用方是宿主，且只在应用启动时调一次**。core 自己不调：它的 `startServer` 会在服务
 * 进程崩溃重启时再跑一遍，那不代表一次新的应用启动（见文件头）。
 */
export function generateManagementToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 本次启动的凭证，供**校验侧**读取。
 *
 * 网关从自己的 `options.token` 拿（那是最直接的一条路），但账号管理路由
 * （`routes/operations/auth.ts`）也要回答「你有没有资格改账号」，而它离网关有好几层。
 * 与其让每一层都把凭证当参数传下去，不如在启动时灌进这个模块一次——
 * 和 `configureSettingsDefaults` 是同一种做法：把启动期的**事实**交给模块，
 * 而不是让它自己去猜。
 *
 * 只存校验用的那一份，仍然不落盘、不打印：凭证的交付通道只有 `./token-file.ts`。
 */
let configuredToken: string | null = null

export function configureManagementToken(token: string | null): void {
  configuredToken = token
}

/**
 * 只取 `headers` 的请求形状。
 *
 * 不直接用 `IncomingMessage`：账号管理路由给自己的判据只需要请求头，而凭证的校验
 * 与「这是一次真实的 HTTP 请求」无关，测试里可以直接递一个字面量。
 */
export interface TokenRequestLike {
  headers: Record<string, string | string[] | undefined>
}

/**
 * 请求是否带着本次启动的有效凭证。
 *
 * 与 `./gateway/access.ts` 的 `hasValidToken` 同一条比较规则（定长比较、数组头一律不认、
 * 未配置时 fail-closed）。这里独立实现一份而不是导出那边那个：那个函数的语义是「管理面
 * 的门」，它变了（比如改成也接受别的头）不该连带改变账号管理的授权判据。
 */
export function hasValidStartupToken(req: TokenRequestLike): boolean {
  const expected = configuredToken
  if (expected === null) return false
  const provided = req.headers[MANAGEMENT_TOKEN_HEADER]
  if (Array.isArray(provided)) return false
  if (typeof provided !== 'string' || provided.length === 0) return false

  const expectedBytes = Buffer.from(expected, 'utf8')
  const providedBytes = Buffer.from(provided, 'utf8')
  if (expectedBytes.length !== providedBytes.length) return false
  return timingSafeEqual(expectedBytes, providedBytes)
}
