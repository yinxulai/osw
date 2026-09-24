import { useEffect, useState } from 'react'
import { AGENT_CLIENT_ICON_URL_BY_KEY, type AgentClientIconTheme } from '@/catalog/clients'
import { cn } from '@/lib/utils'

interface ClientIconProps {
  clientKey: string
  size?: number
  className?: string
}

function getThemeFromDocument(): AgentClientIconTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Agent 客户端品牌图标。
 *
 * 两套主题的图分开取：客户端图标多半是彩色 logo，在暗底上需要另一张（或干脆是同一张，
 * 那就在 `catalog/clients/<key>/icon.svg` 放一张，注册表会把它铺给两套主题）。
 * 主题靠 `MutationObserver` 跟着 `<html class="dark">` 走，与 `ProviderIcon` 同一套做法——
 * 颜色切换发生在 DOM 上，没有可订阅的 React 状态。
 */
export function ClientIcon(props: ClientIconProps) {
  const { clientKey, size = 16, className } = props
  const [theme, setTheme] = useState<AgentClientIconTheme>(() => getThemeFromDocument())

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => setTheme(getThemeFromDocument()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const iconUrl = AGENT_CLIENT_ICON_URL_BY_KEY[clientKey]?.[theme]
  if (!iconUrl) return <span aria-hidden="true" className={cn('shrink-0', className)} style={{ width: size, height: size }} />

  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', className)}
      alt=""
      aria-hidden="true"
    />
  )
}
