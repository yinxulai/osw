import { ToastProvider } from '@/components/ui/toast'
import { LiveRequestsProvider } from '@/data/live-requests'
import { TrayPanelPage } from './pages/tray/page'
import { mountShell } from './shell/providers'
// 放最后：面板专属样式要盖在控制台那份基础样式之上（无 layer 的规则本来就赢过
// `@layer base`，但让顺序也读得出来是哪一边说了算）。
import './pages/tray/tray.css'

/**
 * 托盘面板入口。
 *
 * 与控制台主界面（`main.tsx`）的差别只有两件事，都写在这里：
 *
 * 1. 不挂路由。面板没有可导航的目标，语言与主题在窗口创建前就由 `boot.js` 读进 `<html>`
 *    并交给持久化偏好，不需要地址栏参与（`useResolvedAppearance` 因此也不依赖路由）。
 * 2. 多两个 provider：`LiveRequestsProvider`（一条实时流，面板开着就接）与 `ToastProvider`
 *    （代理开关、打开主界面失败的反馈要落地）。
 *
 * 反过来，与主界面**共用**的部分——`QueryClient` 配置、错误边界、`I18nProvider`——都留在
 * `shell/providers.tsx` 里，这里不再重复一遍。
 */
mountShell('root', (
  <ToastProvider>
    <LiveRequestsProvider enabled>
      <TrayPanelPage />
    </LiveRequestsProvider>
  </ToastProvider>
))
