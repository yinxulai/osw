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
  settings: Pick<Settings, 'apiKeyFeatureEnabled' | 'apiKeyAuthEnabled'>
  onUpdate: <K extends keyof ApiKeyAuthCardProps['settings']>(key: K, value: Settings[K]) => void
}

/**
 * API Key 模块的两级开关。
 *
 * 两行分别是两个不同的问题，所以不合并成一行：
 *
 * - **启用 API Key 功能**：这个模块要不要出现在界面上（侧边栏、管理页、请求日志的 Key 筛选、
 *   总览的按 Key 统计）。关掉等于「我用不到」，数据不会删除，重新打开就都在。
 * - **要求客户端携带 Key**：模块开着的前提下，`/v1/*` 要不要真的拦。默认关，
 *   全新安装不做任何配置就能用——这是「零配置可用」的一部分。
 *
 * 模块关闭时校验开关必须一起失效：模块都不在了还返回 401，等于把自己锁在门外。
 * 所以校验那行的控件在模块关闭时禁用并压暗，保存时由代理侧统一折算。
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
        <FormRow
          title={t('settings.apiKeyAuth.enabled')}
          description={t('settings.apiKeyAuth.enabledDescription')}
          control={(
            <div className="flex items-center gap-2">
              {/* 模块关着的时候没有 Key 可管，入口一起收起来，免得点进去是一片空表。 */}
              {featureEnabled && (
                <Button variant="outline" size="sm" onClick={() => void navigate({ to: routePaths.apiKeys })}>
                  <KeyRound />
                  {t('settings.apiKeyAuth.manage')}
                </Button>
              )}
              <Switch
                checked={featureEnabled && settings.apiKeyAuthEnabled}
                disabled={!featureEnabled}
                onCheckedChange={value => onUpdate('apiKeyAuthEnabled', value)}
                aria-label={t('settings.apiKeyAuth.enabled')}
              />
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
