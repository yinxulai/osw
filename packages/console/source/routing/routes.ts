/**
 * 页面路由路径的唯一事实来源。
 *
 * 路由怎么定义在 `./router.tsx`，但「路径字符串」只在这里出现一次：
 * 跳转、高亮、`to` 参数一律从这里取，禁止在别处再写 `/xxx` 字面量。
 *
 * 命名与 `pages/<module>/` 目录一一对应（路径即模块名），
 * 不再出现「路径叫 `/providers`、页面却叫 `model-management`」这种两套名字的情况。
 */
export const routePaths = {
  /** 新用户引导（全屏特殊页，不参与侧边栏导航） */
  onboarding: '/onboarding',
  /** 智能路由（路由工作台） */
  router: '/router',
  /** 逻辑模型 */
  logicalModels: '/logical-models',
  /** 模型管理 */
  modelManagement: '/model-management',
  /** 统计分析 */
  overview: '/overview',
  /** 统计分析 · 单供应商下钻（带 `$providerId` 路径参数） */
  overviewProvider: '/overview/$providerId',
  /** 请求记录 */
  requestLogs: '/request-logs',
  /** 请求重写 */
  requestRewriteRules: '/request-rewrite-rules',
  /** 客户端配置 */
  clientConfig: '/client-config',
  /** 客户端配置 · 单客户端详情编辑（带 `$clientKey` 路径参数） */
  clientConfigDetail: '/client-config/$clientKey',
  /** 运行日志 */
  logs: '/logs',
  /** 设置 */
  runtimeSettings: '/runtime-settings',
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
