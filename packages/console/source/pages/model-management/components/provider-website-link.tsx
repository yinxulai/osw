import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { getPlatformCapabilities } from '@/platform/capabilities'

interface ProviderWebsiteLinkProps {
  /** 厂商官网。没有（自建供应商对不上内置注册表）时整块不渲染。 */
  url: string | undefined
  className?: string
}

/**
 * 内置厂商官网的外链。
 *
 * 网址来自 `source/catalog/providers/<key>/provider.json` 的 `websiteUrl`，只在「当前这个名字能对上内置厂商」时存在；
 * 对不上就没有这一块，因为自建供应商本来也没有官网可说，不编一个假的出来。
 *
 * 打开方式走 `getPlatformCapabilities().openExternal`：Electron 形态交给系统浏览器，
 * 浏览器形态开新标签页。组件里不出现 `window.electronAPI` 字面量（`docs/product/packaging.md` §5.4）。
 */
export function ProviderWebsiteLink(props: ProviderWebsiteLinkProps) {
  const { url, className } = props
  const t = useTranslation()
  if (!url) return null

  // 只显示域名：`https://www.anthropic.com` 里对用户有信息量的部分就是 `anthropic.com`，
  // 协议头和老式 `www.` 前缀属于噪音。解析失败时退回原串，别把链接吞掉。
  const host = readDisplayHost(url)

  return (
    <button
      type="button"
      onClick={() => getPlatformCapabilities().openExternal(url)}
      title={t('providers.website.open', { host })}
      aria-label={t('providers.website.open', { host })}
      className={cn(
        'inline-flex max-w-44 min-w-0 items-center gap-0.5 system-2xs-regular text-text-tertiary transition-colors',
        'hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none',
        className,
      )}
    >
      <span className="truncate">{host}</span>
      <ExternalLink className="size-3 shrink-0" />
    </button>
  )
}

function readDisplayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
