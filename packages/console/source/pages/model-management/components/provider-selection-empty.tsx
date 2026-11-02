import { MousePointerClick, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from '@/i18n/provider'

interface ProviderSelectionEmptyProps {
  hasProviders: boolean
  onCreate: () => void
}

/** 右栏没有选中供应商时的空态：有供应商就提示选择，没有就提示新建。 */
export function ProviderSelectionEmpty(props: ProviderSelectionEmptyProps) {
  const t = useTranslation()

  return (
    <Card>
      <EmptyState
        icon={MousePointerClick}
        title={props.hasProviders ? t('providers.empty.selectTitle') : t('providers.empty.noneTitle')}
        description={props.hasProviders ? t('providers.empty.selectDescription') : t('providers.empty.noneDescription')}
        action={props.hasProviders ? undefined : (
          <Button size="default" onClick={props.onCreate}>
            <Plus size={14} /> {t('providers.action.create')}
          </Button>
        )}
        className="min-h-64"
      />
    </Card>
  )
}
