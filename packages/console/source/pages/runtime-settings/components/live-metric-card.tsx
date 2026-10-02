import { Gauge } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormHint, FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { getPlatformCapabilities } from '@/platform/capabilities'
import {
  DEFAULT_LIVE_METRIC_TEMPLATE,
  MAX_LIVE_METRIC_LENGTH,
  LIVE_METRIC_VARIABLES,
  hasUnknownLiveMetricVariable,
  type LiveMetricVariableName,
} from '@common/live-metrics'
import type { Settings } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { useTranslation } from '@/i18n/provider'

/**
 * 变量名到「说明文案 key」的静态映射。
 *
 * 刻意不写成模板字符串 ``t(`settings.liveMetric.variable.${name}`)``：`t()` 的 key 是编译期
 * 校验的字面量，拼出来的 key 过不了类型检查，也就丢掉了「漏翻会红」这条保障。写成一张
 * 表之后，变量名 → key 的对应关系是显式的，多一个变量会立刻在这里缺一项。
 */
const VARIABLE_DESCRIPTION_KEYS: Record<LiveMetricVariableName, UiCatalogKey> = {
  liveMaxTps: 'settings.liveMetric.variable.liveMaxTps',
  liveTotalTps: 'settings.liveMetric.variable.liveTotalTps',
  activeRequests: 'settings.liveMetric.variable.activeRequests',
}

interface LiveMetricCardProps {
  settings: Pick<Settings, 'liveMetricTemplate' | 'liveMetricMenuBarEnabled' | 'liveMetricWindowEnabled'>
  onUpdate: <K extends keyof LiveMetricCardProps['settings']>(key: K, value: Settings[K]) => void
}

/**
 * 实时指标设置（标准指标，多个展示面）。
 *
 * 这里配置的是**指标**，不是某个展示面：一段模板 + 一份变量 + 两个「画到哪儿」的开关
 * （菜单栏 / 应用窗口）。两块画布取的是同一份数与同一段模板，所以外观永远一致；把开关
 * 拆开是因为在哪显示是平台能力问题——菜单栏标题只有 macOS 有，窗口角标则跨平台都在。
 *
 * 核心是一个模板输入框 + 一份**完整可用的变量说明**——用户不看到变量清单就写不出模板，
 * 而变量清单必须与引擎里的那一份同源（`@common/live-metrics` 的 `LIVE_METRIC_VARIABLES`），
 * 否则又会演变成「文档写的变量，引擎不认识」。
 */
export function LiveMetricCard(props: LiveMetricCardProps) {
  const { settings, onUpdate } = props
  const t = useTranslation()

  // 平台能力是进程级事实，不会在一次会话里改变，所以直接在渲染里读，不需要订阅。
  // 菜单栏标题只有 macOS 有（Windows 托盘没有图标旁标题，Linux 的 StatusNotifierItem 也没有），
  // 在别的平台上摆一个永远不生效的开关只会误导，所以那一行整行不渲染。
  const menuBarCapable = getPlatformCapabilities().os === 'darwin'

  const template = settings.liveMetricTemplate
  const unknownVariable = hasUnknownLiveMetricVariable(template)

  return (
    <Card>
      <SettingsCardHeader
        icon={<Gauge />}
        title={t('settings.liveMetric.title')}
        description={t('settings.liveMetric.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        {menuBarCapable && (
          <FormRow
            title={t('settings.liveMetric.menuBarEnabled')}
            description={t('settings.liveMetric.menuBarEnabledDescription')}
            control={<Switch checked={settings.liveMetricMenuBarEnabled} onCheckedChange={value => onUpdate('liveMetricMenuBarEnabled', value)} />}
          />
        )}
        <FormRow
          title={t('settings.liveMetric.windowEnabled')}
          description={t('settings.liveMetric.windowEnabledDescription')}
          control={<Switch checked={settings.liveMetricWindowEnabled} onCheckedChange={value => onUpdate('liveMetricWindowEnabled', value)} />}
        />
        <FormRow
          title={t('settings.liveMetric.template')}
          description={t('settings.liveMetric.templateDescription')}
          error={unknownVariable ? t('settings.liveMetric.unknownVariable') : undefined}
          control={(
            <Input
              aria-label={t('settings.liveMetric.template')}
              aria-invalid={unknownVariable}
              className="w-64 font-mono"
              maxLength={MAX_LIVE_METRIC_LENGTH}
              placeholder={DEFAULT_LIVE_METRIC_TEMPLATE}
              value={template}
              onChange={event => onUpdate('liveMetricTemplate', event.target.value)}
            />
          )}
        />

        {/*
         * 变量说明：直接遍历引擎那份清单渲染，所以「这里有哪一个、叫什么、长什么样」
         * 永远和 `renderLiveMetric` 认识的一致。插值用 `{name}` 语法，与模板本身同形，
         * 用户看一眼就会写。
         */}
        <div className="space-y-1.5 py-3">
          <p className="system-xs-medium text-text-secondary">{t('settings.liveMetric.variablesTitle')}</p>
          <ul className="space-y-1">
            {LIVE_METRIC_VARIABLES.map(variable => (
              <li key={variable.name} className="flex flex-wrap items-baseline gap-x-2">
                <code className="rounded bg-components-input-bg-normal px-1.5 py-0.5 font-mono system-xs-regular text-text-secondary">
                  {`{${variable.name}}`}
                </code>
                <span className="system-xs-regular text-text-tertiary">
                  {t(VARIABLE_DESCRIPTION_KEYS[variable.name])}
                </span>
                <span className="font-mono system-xs-regular text-text-quaternary">{variable.sample}</span>
              </li>
            ))}
          </ul>
          <FormHint>{t('settings.liveMetric.variablesHint', { example: DEFAULT_LIVE_METRIC_TEMPLATE })}</FormHint>
        </div>
      </CardContent>
    </Card>
  )
}
