export type Theme = 'light' | 'dark'

const THEME_VALUES: Theme[] = ['light', 'dark']

function isTheme(value: string | null | undefined): value is Theme {
  return value !== null && THEME_VALUES.includes(value as Theme)
}

/**
 * 首帧主题。
 *
 * `index.html` 里的内联脚本会先按同一规则写好 `data-theme`，这里优先读那份结果，
 * 避免 React 接管时又把页面闪回另一套颜色。没有内联结果时再按 URL、系统偏好兜底。
 */
export function initialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'

  const applied = document.documentElement.dataset.theme
  if (isTheme(applied)) return applied

  const query = new URLSearchParams(window.location.search).get('theme')
  if (isTheme(query)) return query

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** 把主题写到根节点与浏览器主题色上。 */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', theme === 'light' ? '#f7f8fa' : '#06070a')
}

/** 当前主题写回 URL，复制地址后仍能打开同一幅界面。 */
export function syncThemeUrl(theme: Theme) {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  url.searchParams.set('theme', theme)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
