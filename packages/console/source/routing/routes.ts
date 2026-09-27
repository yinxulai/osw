/**
 * 页面路由路径的唯一事实来源。
 *
 * 路由怎么定义在 `./router.tsx`，但「路径字符串」只在这里出现一次：
 * 跳转、高亮、`to` 参数一律从这里取，禁止在别处再写 `/xxx` 字面量。
 *
 * 命名与 `pages/<module>/` 目录一一对应（路径即模块名），
 * 不再出现「路径叫 `/providers`、页面却叫 `model-management`」这种两套名字的情况。
 *
 * **每一项都带 `{-$lang}` 这一段。** 它是 TanStack Router 的「可选路径段」：
 * `/router` 与 `/zh-CN/router` 命中同一条路由，只有 `params.lang` 有无之分
 * （未提供时为 `undefined`）。让「带语言」成为路径本身的样子，而不是额外的分支，
 * 是为了不出现两套路由表 —— 同一棵树同时吃下两种地址。
 */

/**
 * 外壳路由的路径模板；下面每一项都以它开头。
 *
 * 放在这里而不是 `./url-overrides.ts`：本模块是纯路径表，导入它不会有任何副作用，
 * 而不依赖浏览器的测试（纯 node 环境）也需要读这些路径 —— 一旦从 `./url-overrides.ts`
 * 转发，这些测试就会顺着依赖链把路由的 history 一起拽进来。依赖方向只能是
 * 「覆盖值读路径表」，不能反过来。
 */
export const SHELL_PREFIX = '/{-$lang}'

export const routePaths = {
  /** 新用户引导（全屏特殊页，不参与侧边栏导航） */
  onboarding: `${SHELL_PREFIX}/onboarding`,
  /** 智能路由（路由工作台） */
  router: `${SHELL_PREFIX}/router`,
  /** 逻辑模型 */
  logicalModels: `${SHELL_PREFIX}/logical-models`,
  /** 模型管理 */
  modelManagement: `${SHELL_PREFIX}/model-management`,
  /** 统计分析 */
  overview: `${SHELL_PREFIX}/overview`,
  /** 统计分析 · 单供应商下钻（带 `$providerId` 路径参数） */
  overviewProvider: `${SHELL_PREFIX}/overview/$providerId`,
  /** 请求记录 */
  requestLogs: `${SHELL_PREFIX}/request-logs`,
  /** 请求重写 */
  requestRewriteRules: `${SHELL_PREFIX}/request-rewrite-rules`,
  /** 客户端配置 */
  clientConfig: `${SHELL_PREFIX}/client-config`,
  /** 客户端配置 · 单客户端详情编辑（带 `$clientKey` 路径参数） */
  clientConfigDetail: `${SHELL_PREFIX}/client-config/$clientKey`,
  /** 运行日志 */
  logs: `${SHELL_PREFIX}/logs`,
  /** 设置 */
  runtimeSettings: `${SHELL_PREFIX}/runtime-settings`,
} as const

/**
 * 不含路径参数的页面路径：侧边栏一级导航只在这些页面之间切换。
 *
 * 引导页是 `App.tsx` 里整屏覆盖的特殊层（没有侧边栏），因此从一级导航的取值里排除，
 * 免得以后有人顺手把它塞进 `baseNavItems`。
 */
export type AppNavPath = Exclude<
  (typeof routePaths)[keyof typeof routePaths],
  typeof routePaths.overviewProvider | typeof routePaths.clientConfigDetail | typeof routePaths.onboarding
>

/** 去掉外壳前缀之后的写法。用条件类型而不是 `string`，路径字面量才能一路带进路由树。 */
type ShellChildPath<Path extends string> = Path extends `${typeof SHELL_PREFIX}${infer Child}` ? Child : Path

/**
 * 把 `routePaths` 里的绝对路径转成「相对于外壳」的写法：`/{-$lang}/overview` → `/overview`。
 *
 * 子路由的 `path` 允许写成绝对形式，拼接时父路由的可选段照常参与生成，
 * 所以截掉前缀既不改最终 fullPath，也不用在 `routePaths` 之外再抄一遍路径字面量。
 *
 * 返回类型必须保留字面量：整棵路由树的 `to` 类型都由这些 `path` 反推，
 * 退化成 `string` 会让所有 `navigate`/`Link` 的 `to` 失配（表现为全项目类型报错）。
 */
export const shellChildPath = <Path extends string>(path: Path): ShellChildPath<Path> =>
  path.slice(SHELL_PREFIX.length) as ShellChildPath<Path>
