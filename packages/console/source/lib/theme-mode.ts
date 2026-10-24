/**
 * 亮暗主题的两个口径。
 *
 * 放在领域层而不是侧栏组件里：`ThemeMode` 是**用户偏好**（三态，含「跟随系统」），
 * `Theme` 是**算完之后实际生效的值**（两态）。偏好要持久化、要跟着设置页走、要被
 * 主进程拿去渲染原生窗口；它和「哪个组件画了那排按钮」没有关系。
 *
 * 之前它声明在 `components/app-sidebar.tsx` 里，于是 store、外观 hook、设置页全都在
 * 从一个视图模块里 import 类型——方向正好是反的：视图换一次结构，状态层就要改一次
 * import。
 */

/** 实际生效的亮暗。 */
export type Theme = 'light' | 'dark'

/** 用户偏好。`system` 表示交给操作系统决定，它不是 `Theme` 的第三个取值。 */
export type ThemeMode = 'system' | Theme
