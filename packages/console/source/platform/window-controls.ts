/**
 * 系统窗口控件（最小化 / 最大化 / 关闭）在渲染层里占走的那块地。
 *
 * 非 macOS 的窗口用 `titleBarStyle: 'hidden'` + `titleBarOverlay` 把原生标题栏换成渲染层
 * 自绘（见 `apps/app/source/index.ts` 的窗口构造），但**控件本身仍是系统的**。Electron 文档
 * 对这一点的措辞很直白：开启 `titleBarOverlay` 后「DOM elements cannot use the area
 * underneath this region」——窗口右上角那块矩形既画不上去、也点不到，`z-index` 再高都没用。
 *
 * 窗口级浮层会整块压在这上面：`Sheet` 是 portal 到 `<body>` 的 `position: fixed` 面板，
 * `side="right"` 时 `inset-y-0 right-0` 撑满整个视口高度，于是它自己的右上角**就是**窗口的
 * 右上角；停在那个角上的关闭按钮正好落进系统保留区，表现成「按钮被窗口菜单盖住了」。
 * 修法只能是让内容避开，不是加层级——判据收在这里，需要避让的浮层用同一个答案。
 *
 * 判据的取值理由：
 * - **只有 Electron 形态**才有原生控件；浏览器的 `os` 是按 UA 猜的（见 `capabilities.ts`），
 *   猜出 `win32` 也不代表有一个原生标题栏。
 * - **macOS 不用这套**：它走 `titleBarStyle: 'hiddenInset'`，红绿灯在左上角且不占渲染层的地盘。
 * - **原生全屏要还回去**：那时系统控件隐藏，右上角重新归渲染层，再留白就是凭空的缺口。
 * - `unknown` 不猜，宁可少留白也不要多留。
 */
import type { PlatformName, PlatformOs } from './capabilities'

export interface WindowControlsOverlayInput {
  platform: PlatformName
  os: PlatformOs
  fullScreen: boolean
}

export function hasWindowControlsOverlay(input: WindowControlsOverlayInput): boolean {
  if (input.platform !== 'electron') return false
  if (input.os !== 'win32' && input.os !== 'linux') return false
  return !input.fullScreen
}

/**
 * 存在系统控件时，右侧浮层往下让出的那条带。
 *
 * `top-9` 必须与 `WindowTitlebar` 的 `h-9`（以及主进程的 `WINDOW_TITLEBAR_HEIGHT = 36`）
 * 同高——三者对不上时，面板要么仍被盖住一角，要么白留一道缝。所以只在这里写一次，
 * 由 {@link hasWindowControlsOverlay} 的调用点共享。
 *
 * `h-auto!` 与 `top` 是成对的：`position: fixed` 同时有 `top` 与 `bottom` 而 `height: auto`
 * 时，高度就由两者夹出来。基础样式与部分调用点还带了 `h-full`（= 100% 视口高），
 * 不写成 `!` 的话面板会以新起点撑满整屏，底部内容被顶到可视区外。
 */
export const WINDOW_CONTROLS_AVOIDANCE = 'top-9! h-auto!'
