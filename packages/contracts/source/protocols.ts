import type { Protocol } from './schemas'

/**
 * 协议的展示名。
 *
 * `OpenAI Completions` / `OpenAI Responses` / `Anthropic Messages` 是这三个接口的正式叫法，
 * 也是上游厂商的产品名——两种界面语言下写法相同，因此不进翻译目录。
 *
 * 放在契约层是因为服务端也要用它：端点缺地址时抛出的错误只携带「哪个协议」这个事实，
 * 展示名作为错误参数交给界面插值（见 `packages/core/source/errors.ts` 的
 * `endpointUrlMissingError`）。界面与服务端各写一份名字，两边迟早会不一致。
 */
export const PROTOCOL_DISPLAY_NAMES: Readonly<Record<Protocol, string>> = {
  'openai-completions': 'OpenAI Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}

/** 端点原生协议可接收的客户端协议。 */
export const CONVERTIBLE_PROTOCOLS: Readonly<Record<Protocol, readonly Protocol[]>> = {
  'openai-completions': ['anthropic-messages', 'openai-responses'],
  'openai-responses': [],
  'anthropic-messages': ['openai-completions'],
}

export function isConvertible(endpointProtocol: Protocol, clientProtocol: Protocol): boolean {
  return endpointProtocol !== clientProtocol
    && CONVERTIBLE_PROTOCOLS[endpointProtocol].includes(clientProtocol)
}

/**
 * 协议的认证头构造规则。
 * 认证是协议的属性，所以和转换能力矩阵放在一起声明：代理透传与管理端的模型列表获取共用同一份规则，
 * 不需要任何一方去 import 对方的内部实现。
 */
export interface ProtocolAuthPreset {
  /** 无论是否配置密钥都要附加的固定头，例如 Anthropic 的版本头。 */
  readonly fixedHeaders: Readonly<Record<string, string>>
  /** 密钥的默认落点；null 表示该协议只需固定头。 */
  readonly headerName: string | null
  /** 密钥值前缀，例如 `Bearer `。 */
  readonly valuePrefix: string
}

export const PROTOCOL_AUTH_PRESETS: Readonly<Record<Protocol, ProtocolAuthPreset>> = {
  'openai-completions': { fixedHeaders: {}, headerName: 'authorization', valuePrefix: 'Bearer ' },
  'openai-responses': { fixedHeaders: {}, headerName: 'authorization', valuePrefix: 'Bearer ' },
  'anthropic-messages': {
    fixedHeaders: { 'anthropic-version': '2023-06-01' },
    headerName: 'x-api-key',
    valuePrefix: '',
  },
}

/**
 * 协议的认证头，拆成两半存放。
 *
 * 拆开是因为这两半对「客户端已经带了同名头」的态度**正好相反**，合成一个对象就表达不出来：
 *
 * - `replace`：密钥的落点。它归供应商配置所有，客户端带来的同名头必须丢掉——客户端那份是
 *   它对**另一家**发的密钥，转发出去既不生效，还把客户端的凭据交给了别人。
 * - `fill`：协议形态要求的头（Anthropic 的 `anthropic-version` 缺了就是 400）。它描述的是
 *   「这个协议长什么样」而不是密钥落在哪，客户端已经带了就尊重客户端的值：它比我们更清楚
 *   自己在说哪个版本，我们只在缺了的时候补一个兜底值。
 *
 * 拆开还让代理那侧的头处理能一句话说清：除鉴权、逐跳头、与位置相关的头之外，客户端带了什么
 * 就转发什么（见 `packages/core/source/proxy/response/headers.ts` 的 `createUpstreamRequestHeaders`）。
 */
export interface ProtocolAuthHeaders {
  /** 由供应商凭据覆盖的头：客户端带来的同名头会被丢弃。 */
  readonly replace: Readonly<Record<string, string>>
  /** 只在客户端没带这个头时补上的头。 */
  readonly fill: Readonly<Record<string, string>>
}

export function resolveProtocolAuthHeaders(protocol: Protocol, apiKey: string | null, customAuthHeader: string | null): ProtocolAuthHeaders {
  const preset = PROTOCOL_AUTH_PRESETS[protocol]
  if (apiKey !== null && customAuthHeader !== null && customAuthHeader !== '') return { replace: { [customAuthHeader]: apiKey }, fill: preset.fixedHeaders }
  if (apiKey === null || preset.headerName === null) return { replace: {}, fill: preset.fixedHeaders }
  return { replace: { [preset.headerName]: `${preset.valuePrefix}${apiKey}` }, fill: preset.fixedHeaders }
}

/**
 * 构造指定协议的认证头（`replace` 与 `fill` 合并成一份）。
 *
 * 供「没有客户端请求要保留」的调用方使用——例如管理端拉取模型列表时自己拼一个请求。
 * 转发客户端请求的那条路必须用 {@link resolveProtocolAuthHeaders} 拿到两半，
 * 否则协议固定头会把客户端自己的值盖掉。
 *
 * 固定头**永远**附加：它们描述的是协议的形态而不是密钥的落点，跟密钥放在哪个头里毫无关系。
 * 自定义认证头只改变「密钥由谁承载」，不改变「这个协议需要哪些头」。
 */
export function createProtocolAuthHeaders(protocol: Protocol, apiKey: string | null, customAuthHeader: string | null): Record<string, string> {
  const { replace, fill } = resolveProtocolAuthHeaders(protocol, apiKey, customAuthHeader)
  return { ...fill, ...replace }
}

/**
 * 对外接口面：客户端可以直接访问的入口清单。
 *
 * 这份清单是**契约**而不是文档：它描述的是「这个服务对外长什么样」，这件事既不属于某一个宿主，
 * 也不属于实现细节。放在契约层之后，它可以被两边的测试各守一半——代理侧断言自己的注册表与它
 * 逐条一致（`packages/core/source/proxy/protocols/interface-surface.test.ts`），
 * 界面侧照着它渲染那张接口表（引导页第三步 `pages/onboarding/components/interface-table-card.tsx`）。于是「说明书过期」不再靠人记得同步，
 * 而是编译或测试直接失败。
 *
 * `paths` 列的是全部等价写法而不是一条：入口的匹配规则本来就成对注册（带 `/v1` 与不带 `/v1`），
 * 客户端从哪一端开始拼路径都能命中。这个事实值得说明白——不说明白，用户就得去猜
 * 「我这边的地址要不要带 /v1」这种别人的实现细节。
 *
 * 有意不收录的东西：厂商名、产品名、任何工具的名字。它们的含义由别人定义、随时会变，
 * 而这个服务的接口面不会因为别人改版而变。
 *
 * **只收真正支持的接口。** 一条入口要站得住，得有「配一个能用的上游地址」的地方：上游地址按协议
 * 配在 ProviderModel 端点上（一个协议一个地址），所以只有与该协议同一接口形态的路径才跑得通。
 * 注册表认得出更多路径（旧版文本补全、文本向量与对话补全同属 `openai-completions`，匹配规则一起
 * 注册），但正文里的路径与端点地址对不上，转发出去只会落到一个聊天接口的地址上。
 * 「认得出」与「支持得住」是两件事，这份清单只承诺后者——写上去的路径，用户照抄就一定能跑通。
 * 注册表里那些认得出但不承诺的路径在代理侧的测试里各自留了名字，多出一条路径必须有人做决定。
 */
export const PROXY_INTERFACE_IDS = [
  'chatCompletions',
  'responses',
  'messages',
  'models',
] as const

export type ProxyInterfaceId = (typeof PROXY_INTERFACE_IDS)[number]

export interface ProxyInterfaceEntry {
  readonly id: ProxyInterfaceId
  /** HTTP 方法，与注册表里声明的一致。 */
  readonly method: string
  /** 该入口的全部等价写法，第一条是主写法。 */
  readonly paths: readonly string[]
  /** 归属协议；`null` 表示这条入口由本地端点直接应答，不转发给上游。 */
  readonly protocol: Protocol | null
}

export const PROXY_INTERFACE_ENTRIES: readonly ProxyInterfaceEntry[] = [
  { id: 'chatCompletions', method: 'POST', paths: ['/v1/chat/completions', '/chat/completions'], protocol: 'openai-completions' },
  { id: 'responses', method: 'POST', paths: ['/v1/responses', '/responses'], protocol: 'openai-responses' },
  { id: 'messages', method: 'POST', paths: ['/v1/messages', '/messages'], protocol: 'anthropic-messages' },
  { id: 'models', method: 'GET', paths: ['/v1/models'], protocol: null },
]
