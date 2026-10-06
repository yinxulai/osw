import { KeyRound, ShieldCheck } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { FormRow } from '@/components/form-kit'
import { Switch } from '@/components/ui/switch'
import type { Settings } from '@common/schemas'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'

interface ApiKeyAuthCardProps {
  settings: Pick<Settings, 'apiKeyAuthEnabled'>
  onUpdate: <K extends keyof ApiKeyAuthCardProps['settings']>(key: K, value: Settings[K]) => void
}

/**
 * 客户端鉴权开关。
 *
 * 默认关：全新安装不做任何配置就能用，这是这个项目「零配置可用」的一部分。
 * 开关旁边直接给「管理 Key」的入口——打开校验却没有一把可用 Key，等于把自己锁在门外，
 * 所以这两个动作在读的人眼里必须挨着。
 */
export function ApiKeyAuthCard(props: ApiKeyAuthCardProps) {
  const { settings, onUpdate } = props
  const t = useTranslation()
  const navigate = useNavigate()

  return (
    <Card data-screenshot="api-key-auth">
      <SettingsCardHeader
        icon={<ShieldCheck />}
        title={t('settings.apiKeyAuth.title')}
        description={t('settings.apiKeyAuth.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.apiKeyAuth.enabled')}
          description={t('settings.apiKeyAuth.enabledDescription')}
          control={(
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void navigate({ to: routePaths.apiKeys })}>
                <KeyRound />
                {t('settings.apiKeyAuth.manage')}
              </Button>
              <Switch
                checked={settings.apiKeyAuthEnabled}
                onCheckedChange={value => onUpdate('apiKeyAuthEnabled', value)}
              />
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
