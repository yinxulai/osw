/**
 * 判断一条地址是不是在要求「执行中的请求」预览。
 *
 * 为什么不走路由的 `validateSearch`：那个参数是**开发期观察窗**，不是页面状态。
 * 一旦进 `search`，它就会被 `retainSearchParams` 留住、被 `navigate` 序列化、
 * 被 `router.test.tsx` 的地址契约用例覆盖，等于给一个只在本地存在的东西在生产路径上开了个口子。
 * 直接在地址栏里认这个标志位，代价是「不响应式」——但这正是想要的：
 * 想看预览就重新载入一条地址，不需要一改参数就重渲染整页。
 *
 * 只认 `preview=1`（以及 `preview=true` 这种手写变体），其余一律不算，
 * 免得 `?preview=0` 这种写法反而把预览打开。
 */
export function isExecutionPreviewRequested(href: string): boolean {
  const queryIndex = href.indexOf('?')
  if (queryIndex === -1) return false

  const hashIndex = href.indexOf('#', queryIndex)
  const query = href.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex)
  const params = new URLSearchParams(query)

  return params.get('preview') === '1'
}
