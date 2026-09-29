import { useEffect } from 'react'
import { useResolvedAppearance } from '@/hooks/use-appearance'
import type { Theme } from '@/components/app-sidebar'

/**
 * 把生效主题落到 `<html>` 上。
 *
 * 主题的真相只有一份（`useResolvedAppearance`：偏好 + 地址栏覆盖），但**画到页面上**
 * 这件事每个渲染入口都要做一次——控制台主界面与托盘面板是两个 HTML 入口。各写一遍
 * `classList.toggle('dark', …)`，某天主题换一种承载方式（类名改属性、多出「高对比」一档），
 * 必然只改一处：面板会停在旧主题上，而它只在浮层里可见，谁都不会立刻发现。
 *
 * 与 `App` 里那段的差别只有「要不要顺手告知宿主」：`getPlatformCapabilities().setTheme`
 * 是主窗口原生标题栏的事，面板不做。
 */
export function useDocumentTheme(): Theme {
  const { theme } = useResolvedAppearance()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return theme
}
