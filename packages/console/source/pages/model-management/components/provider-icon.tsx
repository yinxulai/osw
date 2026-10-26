import { findPresetByName } from '../lib/provider-presets'
import type { ProviderIconTheme } from '../../../catalog/providers'
import { PROVIDER_ICON_URL_BY_KEY } from '../../../catalog/providers'
import { BrandMark } from '@/components/brand-mark'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

interface ProviderIconProps {
  name: string
  size?: number
  className?: string
}

function getThemeFromDocument(): ProviderIconTheme {
  if (typeof document === 'undefined') {
    return 'light'
  }

  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function resolveProviderIconUrl(providerKey: string, theme: ProviderIconTheme): string | null {
  const iconVariants = PROVIDER_ICON_URL_BY_KEY[providerKey]
  if (!iconVariants) {
    return null
  }

  return iconVariants[theme] ?? iconVariants.light ?? null
}

/**
 * 供应商品牌图标。
 * 取 `packages/console/source/catalog/providers/<key>/` 下的 icon.light.svg / icon.dark.svg
 * （按当前主题选一张）；该供应商没有图标时回退到应用标志（`packages/console/public/icon.svg` 里那道彩虹闪电）。
 */
export function ProviderIcon(props: ProviderIconProps) {
  const { name, size = 17, className } = props
  const preset = findPresetByName(name)
  const [theme, setTheme] = useState<ProviderIconTheme>(() => getThemeFromDocument())

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setTheme(getThemeFromDocument())
    })

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  if (preset) {
    const iconUrl = resolveProviderIconUrl(preset.key, theme)
    if (iconUrl) {
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

    return <BrandMark size={size} className={className} matchIconGrid />
  }

  // 兜底：不在预设里的自建供应商，同样用应用标志，留白与其他供应商图标对齐。
  return <BrandMark size={size} className={className} matchIconGrid />
}
