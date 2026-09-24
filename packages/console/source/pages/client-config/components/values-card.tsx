import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ClientConfigAutoFill, ClientConfigChange } from '@common/client-config'
import { CLIENT_CONFIG_SAMPLE_API_KEY } from '@common/client-config'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'

export interface ClientConfigValues {
  baseUrl: string
  apiKey: string
  model: string
  smallModel: string
}

interface ValuesCardProps {
  clientKey: string
  autoFill: ClientConfigAutoFill
  /** 从文件里回读到的现有值（键是注册表里 `fields[].key`）。 */
  detected: Record<string, string>
  /** 本地服务的根地址，作为 Base URL 的默认值。 */
  defaultBaseUrl: string
  /** 兜底模型名（内置默认逻辑模型），文件里读不到模型时用它。 */
  defaultModel: string
  applying: boolean
  /** 最近一次写入产生的改动清单；还没写过时是空数组。 */
  changes: ClientConfigChange[]
  onApply: (values: ClientConfigValues) => void
}

/**
 * 「要写入的值」。
 *
 * 四个值就是这一页能替用户做的全部决定，所以合成一个模块、一行一个，红黑分明：
 * 左边说这是什么，右边填。空值用 `—` 占位而不是留白，因为「读不到」和「是空字符串」
 * 在对用户的意义上不一样——前者要去文件里确认，后者是本来就没有。
 *
 * 初始值只做**回填**，不替用户拍板模型名：文件里读得到就沿用（用户原来的模型选择必须保住），
 * 读不到才落回内置默认逻辑模型。地址与密钥反过来——本地服务的地址和那个固定的
 * `sk-osw` 就是要写进去的东西，给出来比让用户自己编更省事。
 *
 * 为什么预填只能靠「键名猜」：`fields[].key` 是注册表里的语义名，同一个角色在不同客户端上
 * 叫法不同（Claude Code 的密钥叫 `authToken`、小模型叫 `smallFast`）。角色→写法的权威表在
 * core 的 `client-config/rules.ts`（那里才决定写什么），控制台不该、也不能反推它，
 * 所以这里只在**回填**这一件事上按已知别名依次找一遍，找不到就用默认值。
 */
export function ValuesCard(props: ValuesCardProps) {
  const { clientKey, autoFill, detected, defaultBaseUrl, defaultModel, applying, changes, onApply } = props
  const t = useTranslation()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]
  const ready = autoFill === 'ready'
  const disabled = !ready || applying

  const [baseUrl, setBaseUrl] = useState(() => detected.baseUrl || defaultBaseUrl)
  const [apiKey, setApiKey] = useState(() => detected.apiKey || detected.authToken || CLIENT_CONFIG_SAMPLE_API_KEY)
  const [model, setModel] = useState(() => detected.model || detected.mainModel || defaultModel)
  const [smallModel, setSmallModel] = useState(() => detected.smallModel || detected.smallFast || detected.small || '')

  const hint = AUTO_FILL_HINT_KEYS[autoFill]

  return (
    <Card>
      <SettingsCardHeader
        icon={<SlidersHorizontal />}
        title={t('clientConfig.step.values')}
        description={client?.name}
      />

      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          <FormRow
            title={t('clientConfig.label.baseUrl')}
            control={(
              <Input
                aria-label={t('clientConfig.label.baseUrl')}
                className="w-80 font-mono"
                disabled={disabled}
                spellCheck={false}
                value={baseUrl}
                onChange={event => setBaseUrl(event.target.value)}
              />
            )}
          />
          <FormRow
            title={t('clientConfig.label.apiKey')}
            description={t('clientConfig.hint.apiKey', { key: CLIENT_CONFIG_SAMPLE_API_KEY })}
            control={(
              <Input
                aria-label={t('clientConfig.label.apiKey')}
                className="w-80 font-mono"
                disabled={disabled}
                spellCheck={false}
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
              />
            )}
          />
          <FormRow
            title={t('clientConfig.label.model')}
            control={(
              <Input
                aria-label={t('clientConfig.label.model')}
                className="w-80 font-mono"
                disabled={disabled}
                spellCheck={false}
                value={model}
                onChange={event => setModel(event.target.value)}
              />
            )}
          />
          <FormRow
            title={t('clientConfig.label.smallModel')}
            description={t('clientConfig.hint.smallModel')}
            control={(
              <Input
                aria-label={t('clientConfig.label.smallModel')}
                className="w-80 font-mono"
                disabled={disabled}
                spellCheck={false}
                value={smallModel}
                onChange={event => setSmallModel(event.target.value)}
              />
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3">
          <p className="system-xs-regular text-text-tertiary">{t(hint)}</p>
          <Button
            disabled={disabled || !baseUrl.trim() || !model.trim()}
            onClick={() => onApply({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), smallModel: smallModel.trim() })}
          >
            {applying ? t('clientConfig.applying') : t('clientConfig.applyValues')}
          </Button>
        </div>

        <div className="border-t border-border/50 py-3">
          <div className="system-xs-medium text-text-tertiary">{t('clientConfig.changes.title')}</div>
          {changes.length === 0 ? (
            <p className="mt-1 system-sm-regular text-text-quaternary">{t('clientConfig.changes.empty')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {changes.map(change => (
                <li key={change.path} className="flex items-baseline gap-2 system-xs-regular">
                  <span className="shrink-0 font-mono text-text-secondary">{change.path}</span>
                  <span className="min-w-0 truncate text-text-quaternary">
                    {change.before ?? t('clientConfig.changes.removed')} → <span className="text-text-primary">{change.after}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const AUTO_FILL_HINT_KEYS: Record<ClientConfigAutoFill, UiCatalogKey> = {
  ready: 'clientConfig.autoFill.ready',
  unparsable: 'clientConfig.autoFill.unparsable',
  'unsupported-format': 'clientConfig.autoFill.unsupportedFormat',
  'unsupported-client': 'clientConfig.autoFill.unsupportedClient',
}
