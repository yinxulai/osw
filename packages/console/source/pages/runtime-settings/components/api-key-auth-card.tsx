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
  settings: Pick<Settings, 'apiKeyFeatureEnabled'>
  onUpdate: <K extends keyof ApiKeyAuthCardProps['settings']>(key: K, value: Settings[K]) => void
}

/**
 * API Key 模块的开关。
 *
 * 只有一行开关，因为只有**一个**问题要问：这个模块要不要存在。开着就意味着 `/v1/*` 要求携带
 * 有效 Key——「有这个模块」与「认这个模块」是同一件事，拆成两个开关只会造出
 * 「界面上在管 Key、代理侧却不认 Key」的状态。
 *
 * 唯一的例外不在这里配置：库里一把 Key 都没有时代理放行（全新安装不必先建 Key），
 * 建好第一把就自动进入强制。那是从「有没有 Key」推出来的，不是一个需要用户决定的选项。
 */
export function ApiKeyAuthCard(props: ApiKeyAuthCardProps) {
  const { settings, onUpdate } = props
  const t = useTranslation()
  const navigate = useNavigate()
  const featureEnabled = settings.apiKeyFeatureEnabled

  return (
    <Card data-screenshot="api-key-auth">
      <SettingsCardHeader
        icon={<ShieldCheck />}
        title={t('settings.apiKeyAuth.title')}
        description={t('settings.apiKeyAuth.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.apiKeyAuth.feature')}
          description={t('settings.apiKeyAuth.featureDescription')}
          control={(
            <Switch
              checked={featureEnabled}
              onCheckedChange={value => onUpdate('apiKeyFeatureEnabled', value)}
              aria-label={t('settings.apiKeyAuth.feature')}
            />
          )}
        />
        {/* 模块关着的时候没有 Key 可管，入口一起收起来，免得点进去是一片空表。 */}
        {featureEnabled && (
          <FormRow
            title={t('settings.apiKeyAuth.manage')}
            description={t('settings.apiKeyAuth.manageDescription')}
            control={(
              <Button variant="outline" size="sm" onClick={() => void navigate({ to: routePaths.apiKeys })}>
                <KeyRound />
                {t('settings.apiKeyAuth.manageAction')}
              </Button>
            )}
          />
        )}
      </CardContent>
    </Card>
  )
}
