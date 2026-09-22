import { findPresetByName } from '../lib/provider-presets'
import type { ProviderIconTheme } from '../../../providers'
import { PROVIDER_ICON_URL_BY_KEY } from '../../../providers'
import { cn } from '@/lib/utils'
import { useEffect, useId, useState } from 'react'

interface ProviderIconProps {
  name: string
  size?: number
  className?: string
}

/** 标志画布与 `packages/console/public/icon.svg` 的 viewBox 一致；几何以那个文件为唯一真源。 */
const BRAND_MARK_BOX = 256
/** 标志墨迹（含 34 宽描边）实测 175 × 226，居中于画布。 */
const BRAND_MARK_INK_HEIGHT = 226
const BRAND_MARK_CENTER = BRAND_MARK_BOX / 2
/**
 * 各家供应商图标都把自己的图形 contain 在 120 画布的 65 内框里（≈54.2%）。
 * 标志自带一圈画布留白（墨迹只占 226/256 高），若直接铺满会比它们大一圈；
 * 这里按同一个内框折算缩放，让闪电四周的留白和别的 icon 一致。
 */
const BRAND_MARK_SCALE = (BRAND_MARK_BOX * (65 / 120)) / BRAND_MARK_INK_HEIGHT

/** 应用标志：一道彩虹渐变的斜切闪电（`packages/console/public/icon.svg` 的内联版）。 */
type BrandMarkProps = {
  size: number
  className?: string
}

function BrandMark(props: BrandMarkProps) {
  const gradientId = `brand-mark-${useId().replace(/:/g, '')}`
  const paint = `url(#${gradientId})`

  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${BRAND_MARK_BOX} ${BRAND_MARK_BOX}`}
      className={cn('shrink-0', props.className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="41" y1="16" x2="215" y2="241">
          <stop offset="0" stopColor="#FFE066" />
          <stop offset="0.38" stopColor="#FF9500" />
          <stop offset="0.72" stopColor="#F0297C" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <g
        transform={`translate(${BRAND_MARK_CENTER} ${BRAND_MARK_CENTER}) scale(${BRAND_MARK_SCALE}) translate(${-BRAND_MARK_CENTER} ${-BRAND_MARK_CENTER})`}
      >
        <path
          d="M186 33L58 148H114L84 224L198 108H142Z"
          fill={paint}
          stroke={paint}
          strokeWidth="34"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
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
 * 直接使用 packages/console/source/providers 中每个 provider 子目录的 icon.svg，
 * 缺失时回退到应用标志（`packages/console/public/icon.svg` 里那道彩虹闪电）。
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

    return <BrandMark size={size} className={className} />
  }

  // 兜底：不在预设里的自建供应商，同样用应用标志，留白与其他供应商图标对齐。
  return <BrandMark size={size} className={className} />
}
