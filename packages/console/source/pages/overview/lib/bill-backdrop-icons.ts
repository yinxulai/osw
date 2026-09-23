/**
 * 导出场景背景用的厂商图标。
 *
 * 不走 `providers/index.ts` 的 `iconUrls`（那是给 `<img src>` 用的构建产物 URL）：
 * `html-to-image` 在把 DOM 光栅化前会去 `fetch` 每个 `<img>` 的资源再转 data URL，
 * 而桌面端是 `file://` 加载的，那里的 `fetch` 会被浏览器直接拒绝，导出图里的图标会整片消失。
 *
 * 所以这里在构建期用 `?raw` 把 SVG 源码读成字符串，自己转成 data URL：
 * 图标随 JS 一起进包，导出过程完全不碰网络；而且 SVG 放在 `<img>` 里是独立文档，
 * 各家图标里同名（`mask0_1_*` 这种）的 `<mask>` / `<linearGradient>` id 也不会互相打架。
 *
 * 取的是 dark 变体：导出背景是深色半透明底板，light 变体里那些纯黑图形会糊成一团黑块。
 */
const iconSourceModules = import.meta.glob('../../../providers/*/icon.dark.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export const BILL_BACKDROP_ICON_URLS: string[] = Object.keys(iconSourceModules)
  .sort()
  .map(path => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSourceModules[path])}`)
