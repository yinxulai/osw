import type { ReactNode } from 'react'
import { Server } from 'lucide-react'
import { CLIENT_CONFIG_SAMPLE_API_KEY } from '@common/client-config'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { CopyButton } from './copy-button'
import { FormRow } from './form-kit'
import { InfoHint } from './info-hint'
import { SettingsCardHeader } from './settings-card-header'
import { Card, CardContent } from './ui/card'
import { useTranslation } from '@/i18n/provider'

interface AddressCardProps {
  origin: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
  /** 卡片名与说明：默认是引导页那一套；客户端配置页说的是「照抄哪两个值」，需要另一句话。 */
  title?: string
  description?: string
  /**
   * 是否摆「模型名」这一行。
   *
   * 引导页三个值一起给（用户只来一次，一次给全）；客户端配置页只给地址与密钥——
   * 那一页的模型名由列表与详情负责，在同一块版面上再摆一个默认模型名，会让
   * 「模型名是可选的」这件事重新变得含糊。所以这一行由调用方决定要不要。
   */
  showModelName?: boolean
  /**
   * 两行长说明的摆法。
   *
   * `'paragraph'`（默认）：摆在字段标题下面，占满行宽。客户端配置页用这一档——它是并排两张参考卡，
   * 读者就是来查「这个值是什么」的，说明摊开正好。
   *
   * `'icon'`：收进标题行那枚小图标，浮入/聚焦才展开。新手引导用这一档：那一步的主线是
   * 「把值填进客户端」，用户此刻并不需要知道「本地不校验鉴权」「模型名只是路由输入」这两件事的来龙去脉，
   * 两段长说明却各占两三行、把卡片撑得比地址本身还重。收进图标后默认视图只剩「值 + 复制」，
   * 想知道为什么的人点开就能读到同一句话。
   *
   * 为什么做成参数而不是在引导页另写一张卡：地址怎么拼、密钥是什么、模型名兜底用哪个，
   * 这三件事的推导只能有一处（见下面那段说明），摆法才该由调用方选。
   */
  hintStyle?: 'paragraph' | 'icon'
  /**
   * 卡片底部的一条收尾行（`border-t` 分隔、贴着卡片下边缘）。
   *
   * 引导页用它把「还有一条不用手抄的路」并进这张卡：那件事与地址卡说的是**同一件事的两面**
   * （照抄 / 代抄），原设计也要求两者必须挨着摆、中间不插别的内容。
   * 单独摆成第二张卡会让它和地址卡平起平坐，读者先看到的是「有两张卡」而不是「有一组值」；
   * 收进同一张卡的收尾行里，值仍然是这一屏唯一的主体。
   *
   * 做成槽位而不是布尔开关：这一行放什么由调用方决定，卡片只负责给它一条分割线与贴边留白。
   */
  footer?: ReactNode
}

/**
 * 「客户端要填进自己配置的那几个值」：一条地址 + 若干照抄值。
 *
 * 两个页面给的是同一组事实（地址怎么拼、密钥是什么、模型名兜底用哪个），只是摆法按场景取舍，
 * 所以卡片本身共享，行的增减去由调用方传参——两处各写一遍的结果是迟早会算出两个地址。
 *
 * 用户从这里只带走几个值，而只有地址会写错：它有两种写法（带不带 `/v1`），两种服务端都受理
 * （见 `@common/protocols` 的接口清单）。所以页面上只出现**一条**地址，另一种写法降级成一句说明：
 * 两条并列的地址只差一个 `/v1`，抄错行是这里最贵的错误。
 *
 * Key 与模型名排在下面，用同一种「左标题说明、右值」的设置行，不给它们和地址一样的版面：
 * 两个都不是「唯一的正确答案」——Key 本地不校验鉴权，模型名只是路由的输入（`default` 只是兜底那一个）。
 * 值旁边一句说明足以说清这件事，不需要再多一块版面。
 *
 * 各行的复制入口是同一个组件、同一种形态：地址只是字号更大。重要性由值自己承担，
 * 不靠换一种按钮来说——一列值里混着两种复制按钮，读起来像是两种不同的操作。
 */
export function AddressCard(props: AddressCardProps) {
  const { origin, copiedKey, onCopy, title, description, showModelName = true, hintStyle = 'paragraph', footer } = props
  const t = useTranslation()
  const hintAsIcon = hintStyle === 'icon'

  /** 标题行右侧那枚口径图标；`'paragraph'` 档下返回 `undefined`，说明改走 `FormRow` 的 description 位。 */
  const hintIcon = (key: 'access.field.apiKey.hint' | 'access.field.model.hint') =>
    hintAsIcon ? <InfoHint text={t(key)} /> : undefined

  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title={title ?? t('access.address.title')}
        description={description ?? t('access.address.description')}
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
          {/* 这一句常驻：它不是口径，而是**唯一会抄错的那个值**怎么抄都对这件事本身。 */}
          <p className="mt-1.5 system-xs-regular text-text-tertiary">{t('access.address.hint')}</p>
        </div>

        <FormRow
          title={(
            <span className="inline-flex items-center gap-1.5">
              {t('access.field.apiKey.label')}
              {hintIcon('access.field.apiKey.hint')}
            </span>
          )}
          description={hintAsIcon ? undefined : t('access.field.apiKey.hint')}
          control={(
            <ValueWithCopy
              itemKey="apiKey"
              value={CLIENT_CONFIG_SAMPLE_API_KEY}
              label={t('access.field.apiKey.copy')}
              copiedKey={copiedKey}
              onCopy={onCopy}
            />
          )}
        />

        {showModelName ? (
          <FormRow
            title={(
              <span className="inline-flex items-center gap-1.5">
                {t('access.field.model.label')}
                {hintIcon('access.field.model.hint')}
              </span>
            )}
            description={hintAsIcon ? undefined : t('access.field.model.hint')}
            control={(
              <ValueWithCopy
                itemKey="modelName"
                value={BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME}
                label={t('access.field.model.copy')}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            )}
          />
        ) : null}
      </CardContent>

      {/* 收尾行贴在卡片下边缘：与上面几行同一条发丝线分隔，左右留白也与内容区对齐。 */}
      {footer ? <div className="border-t border-border/50 px-4 py-3">{footer}</div> : null}
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
