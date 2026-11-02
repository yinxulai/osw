import { Download, FlaskConical, Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'

interface ProviderPageActionsProps {
  providerCount: number
  onImport: () => void
  onExportAll: () => void
  onOpenTestPanel: () => void
  onCreate: () => void
}

/** 模型管理页头部的四个动作；按钮顺序即使用频率。 */
export function ProviderPageActions(props: ProviderPageActionsProps) {
  const t = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={props.onImport}>
        <Upload size={14} /> {t('providers.action.import')}
      </Button>
      <Button
        variant="outline"
        disabled={props.providerCount === 0}
        onClick={props.onExportAll}
      >
        <Download size={14} /> {t('providers.action.exportAll')}
      </Button>
      <Button variant="outline" onClick={props.onOpenTestPanel}>
        <FlaskConical size={14} /> {t('providers.action.connectionTest')}
      </Button>
      <Button onClick={props.onCreate}>
        <Plus size={14} /> {t('providers.action.create')}
      </Button>
    </div>
  )
}
