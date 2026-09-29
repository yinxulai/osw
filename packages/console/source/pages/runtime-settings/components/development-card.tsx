import { Camera, Database, LoaderCircle } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'

interface DevelopmentCardProps {
  onSeedDevelopment: () => void
  onExportScreenshots: () => void
  exportingScreenshots: boolean
  screenshotProgress: ScreenshotExportProgress | null
}

export function DevelopmentCard(props: DevelopmentCardProps) {
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader icon={<Database />} title={t('settings.development.title')} description={t('settings.development.description')} />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.development.screenshots')}
          description={t('settings.development.screenshotsDescription')}
          control={(
            <Button
              variant="secondary"
              disabled={props.exportingScreenshots}
              onClick={props.onExportScreenshots}
            >
              {props.exportingScreenshots
                ? <LoaderCircle className="animate-spin" />
                : <Camera className="size-3.5" />}
              {props.screenshotProgress
                ? t('settings.development.screenshotsProgress', {
                    completed: props.screenshotProgress.completed,
                    total: props.screenshotProgress.total,
                  })
                : props.exportingScreenshots
                  ? t('settings.development.screenshotsRunning')
                  : t('settings.development.screenshotsAction')}
            </Button>
          )}
        />
        <FormRow
          title={t('settings.development.seed')}
          description={t('settings.development.seedDescription')}
          control={(
            <Button variant="secondary" onClick={props.onSeedDevelopment}>
              <Database className="size-3.5" />
              {t('settings.development.seedAction')}
            </Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
