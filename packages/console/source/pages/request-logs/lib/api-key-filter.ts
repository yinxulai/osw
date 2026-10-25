/**
 * 请求记录里「按 API Key 筛选」这一维的取值翻译。
 *
 * 这里之所以单独成一个文件，是因为这一维的三个取值很容易被写混：
 *
 * | 界面取值 | 含义 | 发给服务端 |
 * |---|---|---|
 * | `'all'` | 不按 Key 筛 | **不发** `apiKeyId` |
 * | `'anonymous'` | 只看没带 Key 的请求 | `apiKeyId: null` |
 * | `ak_xxx` | 只看这一把 Key | `apiKeyId: 'ak_xxx'` |
 *
 * 关键在第二行：服务端把 `null` 当成一个**真实的筛选条件**（`apiKeyId IS NULL`，见
 * `request-log-store.ts`），而不是「没筛」。所以界面绝不能拿 `null` 兼任「没选」——
 * 那样「不筛」会静默变成「只看匿名」，而两条结果集完全不同，界面上却看不出区别。
 *
 * 放在 `lib/` 而不是 `.tsx`：这是一段纯逻辑，配了不渲染 React 的单测。
 */

/** 筛「未跟踪请求」时界面上的取值。不会与 Key 的 id（`ak_*`）撞。 */
export const ANONYMOUS_API_KEY = 'anonymous'

/** 不按 Key 筛时界面上的取值。与其它筛选维度一致。 */
export const ALL_API_KEYS = 'all'

/**
 * 把界面取值翻成接口参数。
 *
 * 返回空对象表示「这一维不参与筛选」，调用方直接展开即可。
 */
export function apiKeyIdParam(apiKeyId: string): { apiKeyId?: string | null } {
  if (apiKeyId === ALL_API_KEYS) return {}
  return { apiKeyId: apiKeyId === ANONYMOUS_API_KEY ? null : apiKeyId }
}

/**
 * 请求记录里的 `apiKeyId` 反查展示名。
 *
 * 记录只存 id，名字靠当前 Key 列表实时反查（改名后历史记录跟着换标签）。
 * 查不到说明这把 Key 已被删除——历史记录照旧展示，只是标成「已删除」，
 * 与 `logicalModelId` 的处理同构。
 */
/** 反查展示名时用的 Key 选项：只需要 id 与名字。 */
export type ApiKeyLabelOption = { id: string; name: string; deletedTime?: number | null }

/** 「未跟踪 / 已删除」两种特殊情况的文案，由调用方从翻译目录里取。 */
export type ApiKeyLabelText = { anonymous: string; unknown: string }

/** 反查结果：名字 + 它代表的那个 Key 现在还在不在。 */
export interface ApiKeyLabelResult {
  name: string
  /** 这个名字属于一把已软删除的 Key：名字照旧展示，后面补一枚「已删除」标签。 */
  deleted: boolean
}

/**
 * 把记录里的 `apiKeyId` 翻成「名字 + 是否已删除」。
 *
 * 传进来的 `keys` 应该是**含软删除**的那份：Key 是软删除，删掉之后名字还在，
 * 历史记录依旧指向它。只拿活跃列表来查会把它退化成占位的「已删除的 Key」文案，
 * 把「这次请求是谁发的」这个历史事实丢掉。
 *
 * `labels.unknown` 只给「记录指向的配置真的不存在」用，与供应商 / 模型同一口径。
 */
export function apiKeyLabel(apiKeyId: string | null, keys: ReadonlyArray<ApiKeyLabelOption>, labels: ApiKeyLabelText): ApiKeyLabelResult {
  if (apiKeyId === null) return { name: labels.anonymous, deleted: false }
  const key = keys.find(item => item.id === apiKeyId)
  if (key === undefined) return { name: labels.unknown, deleted: false }
  return { name: key.name, deleted: key.deletedTime != null }
}
