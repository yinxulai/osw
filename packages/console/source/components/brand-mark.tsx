import { useId } from 'react'

import { cn } from '@/lib/utils'

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
const BRAND_MARK_ICON_GRID_SCALE = (BRAND_MARK_BOX * (65 / 120)) / BRAND_MARK_INK_HEIGHT

type BrandMarkProps = {
  size: number
  className?: string
  /**
   * 按「供应商图标网格」（120 画布里的 65 内框）缩小一圈。
   * 默认 `false`：标志自己的画布留白就够，直接铺满指定尺寸——
   * 登录页那种品牌位要的是「一道尽量大的闪电」，而不是与别人对齐的图标格。
   */
  matchIconGrid?: boolean
}

/**
 * 应用标志：一道彩虹渐变的斜切闪电（`packages/console/public/icon.svg` 的内联版）。
 *
 * 单独成文件是因为它有两类消费方：需要与供应商图标对齐的 `ProviderIcon`，
 * 和不需要对齐、只想要品牌本身的页面（登录页）。内联而不是 `<img>` 的唯一理由是
 * 尺寸：`icon.svg` 会把 256 的画布连留白一起缩到给定尺寸，闪电实际只占到 68%——
 * 在 34px 的品牌位上只剩 23px，看着比旁边的字还小。
 */
export function BrandMark(props: BrandMarkProps) {
  const gradientId = `brand-mark-${useId().replace(/:/g, '')}`
  const paint = `url(#${gradientId})`
  const scale = props.matchIconGrid ? BRAND_MARK_ICON_GRID_SCALE : 1

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
        transform={`translate(${BRAND_MARK_CENTER} ${BRAND_MARK_CENTER}) scale(${scale}) translate(${-BRAND_MARK_CENTER} ${-BRAND_MARK_CENTER})`}
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
