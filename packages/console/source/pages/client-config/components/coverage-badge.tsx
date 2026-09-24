import type { ClientConfigAutoFill, ClientConfigCoverage } from '@common/client-config'
import { Badge } from '@/components/ui/badge'
import { InfoHint } from '@/components/info-hint'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'

interface CoverageBadgeProps {
  coverage: ClientConfigCoverage
  /** 距离「已生效」还差几处改动；只有 `pending` 会把它写进徽标。 */
  pendingChanges: number
  /** `unavailable` 时用来区分「没有配方」「格式不支持」「内容语法坏了」。 */
  autoFill: ClientConfigAutoFill
}

const COVERAGE_KEYS: Record<ClientConfigCoverage, UiCatalogKey> = {
  applied: 'clientConfig.coverage.applied',
  pending: 'clientConfig.coverage.pending',
  absent: 'clientConfig.coverage.absent',
  unavailable: 'clientConfig.coverage.unavailable',
}

/**
 * 「不可自动生效」的三种原因各有各的下一步，所以文案分开写，
 * 而不是统一说一句「不支持」让用户自己去猜。
 */
const UNAVAILABLE_REASON_KEYS: Record<Exclude<ClientConfigAutoFill, 'ready'>, UiCatalogKey> = {
  unparsable: 'clientConfig.autoFill.unparsable',
  'unsupported-format': 'clientConfig.autoFill.unsupportedFormat',
  'unsupported-client': 'clientConfig.autoFill.unsupportedClient',
}

/**
 * 覆盖状态徽标。
 *
 * 颜色只用来分「绿=已成 / 黄=该点一下 / 灰=还不是我们的地盘」，具体含义写在徽标文字里——
 * 列表里一列小字，靠色相辨认太容易被误读。`unavailable` 额外挂一枚口径图标：
 * 它是最容易被误解成「出错了」的一档，得能点开看到「为什么」。
 */
export function CoverageBadge(props: CoverageBadgeProps) {
  const { coverage, pendingChanges, autoFill } = props
  const t = useTranslation()
  const variant = coverage === 'applied' ? 'success' : coverage === 'pending' ? 'warning' : coverage === 'absent' ? 'muted' : 'outline'
  const label = t(COVERAGE_KEYS[coverage], { count: pendingChanges })

  return (
    <span className="flex items-center gap-1">
      <Badge variant={variant}>{label}</Badge>
      {coverage === 'unavailable' && autoFill !== 'ready' && <InfoHint text={t(UNAVAILABLE_REASON_KEYS[autoFill])} />}
    </span>
  )
}
