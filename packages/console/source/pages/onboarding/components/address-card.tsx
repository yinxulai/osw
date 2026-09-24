import { Server } from 'lucide-react'
import { FormRow } from '@/components/form-kit'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslation } from '@/i18n/provider'
import { SAMPLE_API_KEY, SAMPLE_MODEL_NAME } from '../service-facts'
import { CopyButton } from './copy-button'

interface AddressCardProps {
  origin: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/**
 * 这一页的落点：一条地址 + 两个要填的值。
 *
 * 用户从这一页只带走三个值，而三个里只有地址会写错——它有两种写法（带不带 `/v1`），
 * 两种服务端都受理（见 `@common/protocols` 的接口清单）。所以页面上只出现**一条**地址，
 * 另一种写法降级成一句话说明：两条并列的地址只差一个 `/v1`，抄错行是这里最贵的错误。
 *
 * Key 与模型名排在下面，用同一种「左标题说明、右值」的设置行，不给它们和地址一样的版面：
 * 两个都不是「唯一的正确答案」——Key 本地不校验鉴权，模型名只是路由的输入（`default` 只是兜底那一个）。
 * 值旁边一句说明足以说清这件事，不需要再多一块版面。
 *
 * 三行的复制入口是同一个组件、同一种形态：地址只是字号更大。重要性由值自己承担，
 * 不靠换一种按钮来说——一列值里混着两种复制按钮，读起来像是两种不同的操作。
 */
export function AddressCard(props: AddressCardProps) {
  const { origin, copiedKey, onCopy } = props
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title={t('access.address.title')}
        description={t('access.address.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <div className="py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* 全页唯一的大号等宽值。地址读不出来时摆「—」而不是收起来：布局不跟着数据有无变形。 */}
            <span className="min-w-0 font-mono system-xl-medium text-text-primary select-all">
              {origin || '—'}
            </span>
            <CopyButton
              itemKey="origin"
              value={origin}
              copiedKey={copiedKey}
              onCopy={onCopy}
              label={t('access.address.copy')}
            />
          </div>
          <p className="mt-1.5 system-xs-regular text-text-tertiary">{t('access.address.hint')}</p>
        </div>

        <FormRow
          title={t('access.field.apiKey.label')}
          description={t('access.field.apiKey.hint')}
          control={(
            <ValueWithCopy
              itemKey="apiKey"
              value={SAMPLE_API_KEY}
              label={t('access.field.apiKey.copy')}
              copiedKey={copiedKey}
              onCopy={onCopy}
            />
          )}
        />

        <FormRow
          title={t('access.field.model.label')}
          description={t('access.field.model.hint')}
          control={(
            <ValueWithCopy
              itemKey="modelName"
              value={SAMPLE_MODEL_NAME}
              label={t('access.field.model.copy')}
              copiedKey={copiedKey}
              onCopy={onCopy}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}

interface ValueWithCopyProps {
  itemKey: string
  value: string
  label: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/**
 * 行内的可复制值：等宽值 + 复制按钮。
 * 地址那一行用的是同一对东西，只是值更大、不带左边的设置行标题。
 */
function ValueWithCopy(props: ValueWithCopyProps) {
  const { itemKey, value, label, copiedKey, onCopy } = props

  return (
    <>
      <span className="font-mono system-sm-medium text-text-secondary select-all">{value}</span>
      <CopyButton itemKey={itemKey} value={value} label={label} copiedKey={copiedKey} onCopy={onCopy} />
    </>
  )
}
