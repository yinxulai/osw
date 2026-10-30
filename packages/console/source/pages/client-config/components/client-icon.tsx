import { AGENT_CLIENT_ICON_URL_BY_KEY } from '@/catalog/clients'
import { cn } from '@/lib/utils'
import { useAppliedTheme } from '@/hooks/use-applied-theme'

interface ClientIconProps {
  clientKey: string
  size?: number
  className?: string
}

/**
 * Agent 客户端品牌图标。
 *
 * 两套主题的图分开取：客户端图标多半是彩色 logo，在暗底上需要另一张（或干脆是同一张，
 * 那就在 `packages/contracts/source/clients/<key>/icon.svg` 放一张，注册表会把它铺给两套主题）。
 * 主题跟着**生效**的 `<html class="dark">` 走（`useAppliedTheme`），与 `ProviderIcon` 同一套做法——
 * 颜色切换发生在 DOM 上，共享同一个外部存储，组件自己不再持有订阅。
 */
export function ClientIcon(props: ClientIconProps) {
  const { clientKey, size = 16, className } = props
  const theme = useAppliedTheme()

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
