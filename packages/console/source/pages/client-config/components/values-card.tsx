import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ClientConfigAutoFill, ClientConfigChange } from '@common/client-config'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'

export interface ClientConfigValues {
  model: string
  smallModel: string
}

interface ValuesCardProps {
  clientKey: string
  autoFill: ClientConfigAutoFill
  /** 从文件里回读到的现有值（键是注册表里 `fields[].key`）。 */
  detected: Record<string, string>
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
 * 这一页只让用户决定**模型名**：它属于用户自己的取舍（本地服务不校验模型名，任何非空名字都能透传）。
 * 地址与密钥恰好相反——客户端要指向的就是本机服务本身，那两个值只有一种正确答案，
 * 所以既不给输入框也不做展示，直接由服务端写入（见 `ClientConfigApplyRequestSchema`）。
 * 需要看那两个值的人去引导页第三步看，那里才是它们该出现的地方。
 *
 * 两行红黑分明：左边说这是什么，右边填。空值用 `—` 占位而不是留白，因为「读不到」和
 * 「是空字符串」在对用户的意义上不一样——前者要去文件里确认，后者是本来就没有。
 *
 * 初始值只做**回填**，不替用户拍板模型名：文件里读得到就沿用（用户原来的模型选择必须保住），
 * 读不到才落回内置默认逻辑模型。
 *
 * 为什么预填只能靠「键名猜」：`fields[].key` 是注册表里的语义名，同一个角色在不同客户端上
 * 叫法不同（Claude Code 的小模型叫 `smallFast`）。角色→写法的权威表在 core 的
 * `client-config/rules.ts`（那里才决定写什么），控制台不该、也不能反推它，
 * 所以这里只在**回填**这一件事上按已知别名依次找一遍，找不到就用默认值。
 */
export function ValuesCard(props: ValuesCardProps) {
  const { clientKey, autoFill, detected, defaultModel, applying, changes, onApply } = props
  const t = useTranslation()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]
  const ready = autoFill === 'ready'
  const disabled = !ready || applying

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
            disabled={disabled || !model.trim()}
            onClick={() => onApply({ model: model.trim(), smallModel: smallModel.trim() })}
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
