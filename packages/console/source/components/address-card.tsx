import type { ReactNode } from 'react'
import { Server } from 'lucide-react'
import { CopyButton } from './copy-button'
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
   * 主体的摆法。
   *
   * `'stacked'`（默认）：一条大号地址 + 一句说明。引导页用这一档——
   * 那一步读者要做的就是照抄，地址是全页字号最大的东西，摆在最上面。
   *
   * `'cards'`：同一条地址收进凹槽、复制按钮贴右端。客户端配置页用这一档
   * ——那一页是并排两张参考卡，左卡只有半页宽，摆法跟着窄一点。
   */
  layout?: 'stacked' | 'cards'
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
 * 「本机服务地址」：客户端要指向的那**一条**地址。
 *
 * 两个页面给的是同一个事实（地址怎么拼），只是摆法按场景取舍，所以卡片本身共享，
 * 摆法由调用方传参——两处各写一遍的结果是迟早会算出两个地址。
 *
 * 页面上只出现**一条**地址，另一种写法（带不带 `/v1`）降级成一句说明：它有两种写法，两种服务端都受理
 * （见 `@common/protocols` 的接口清单），而两条并列的地址只差一个 `/v1`，抄错行是这里最贵的错误。
 *
 * 密钥与模型名不在这张卡上：前者本地不校验鉴权、填什么都行，后者只是路由的输入、`default` 只是兜底那一个
 * ——两个都不是「唯一的正确答案」，摆出来只会让「这里真有两个值要抄」盖过地址本身。
 * 想就地改客户端配置的人，看向紧跟在下面的配置编辑器，而不是在这张卡里再讲一遍怎么填。
 *
 * 复制入口是同一个组件、同一种形态：地址只是字号更大。重要性由值自己承担，
 * 不靠换一种按钮来说——一列值里混着两种复制按钮，读起来像是两种不同的操作。
 */
export function AddressCard(props: AddressCardProps) {
  const { origin, copiedKey, onCopy, title, description, layout = 'stacked', footer } = props
  const t = useTranslation()
  const cards = layout === 'cards'

  /* `'cards'`：只摆地址一个值。
     内容块 `flex-1` 且垂直居中：与右侧接口卡并排时两卡等高，这一栏内容比对面少，
     让这一块落在中间，空白才像是留白而不是「下面还没渲染出来」。 */
  const body = cards ? (
    <div className="flex flex-1 flex-col justify-center px-4 py-3">
      <div className="system-sm-medium text-text-secondary">{t('access.field.baseUrl.label')}</div>
      <p className="mt-1 system-xs-regular text-text-tertiary">{t('access.address.hint')}</p>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-module-border bg-inset py-1 pr-1 pl-3">
        {/* 地址读不出来时摆「—」而不是收起来：布局不跟着数据有无变形。 */}
        <span className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-primary select-all">
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
    </div>
  ) : (
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
  )

  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title={title ?? t('access.address.title')}
        description={description ?? t('access.address.description')}
      />
      {cards ? body : <CardContent className="divide-y divide-border/50 px-4">{body}</CardContent>}

      {/* 收尾行贴在卡片下边缘：`data-slot="card-footer"` 让卡片自己去掉底部留白（见 `ui/card`），
          与上面几行同一条发丝线分隔，左右留白也与内容区对齐。 */}
      {footer ? (
        <div data-slot="card-footer" className="border-t border-border/50 px-4 py-3">
          {footer}
        </div>
      ) : null}
    </Card>
  )
}
