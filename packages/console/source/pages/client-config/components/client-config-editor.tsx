import { useState } from 'react'
import { CircleSlash } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormSelect, type FormOption } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITIONS } from '@/catalog/clients'
import { ConfigEditorBody } from './config-editor-body'
import { useClientConfigEditor } from '../hooks/use-client-config-editor'

interface ClientConfigEditorProps {
  /** 打开时先落到哪个客户端；缺省是清单里排第一的那个。 */
  defaultClientKey?: string
  /** 卡头图标；不传就不摆图标（引导页的卡都只有标题）。 */
  icon?: React.ReactNode
}

/**
 * 「挑一个客户端、就地改它的配置」——一张自足的卡：上面一行选客户端，下面就是那份文件的编辑区
 * （要写入的模型 + 内容）。详情页把这块正文铺满整页，引导页「接入工具」那一步则把它整张嵌进来，
 * 让用户不必跳到另一页就能把配置改对——引导里做的动作，在正式页面里已经是生效的结果。
 *
 * 与详情页共用同一套状态（`useClientConfigEditor`）与同一块正文（`ConfigEditorBody`），
 * 差别只在这里多了一层「选哪个客户端」：详情页的身份来自路由参数（「我要看这一个」），
 * 引导页没有那个前提，得让用户自己挑。
 *
 * 客户端选择器用**名字**而不是品牌图标：这张卡在引导里是「把刚才那个地址填进去」的落点，
 * 用户此刻认的是「我平时用哪个工具」，名字比图标先对得上号；图标留给列表页那种一排并排的场景。
 */
export function ClientConfigEditor(props: ClientConfigEditorProps) {
  const { defaultClientKey, icon } = props
  const t = useTranslation()
  const [clientKey, setClientKey] = useState(defaultClientKey ?? AGENT_CLIENT_DEFINITIONS[0]?.key ?? '')
  const editor = useClientConfigEditor(clientKey)
  const { loading, error, client } = editor

  const options: FormOption[] = AGENT_CLIENT_DEFINITIONS.map(item => ({ value: item.key, label: item.name }))

  return (
    <Card>
      <SettingsCardHeader
        icon={icon}
        title={t('clientConfig.editor.title')}
        description={t('clientConfig.editor.description')}
        actions={(
          <FormSelect
            ariaLabel={t('clientConfig.selectClient')}
            className="w-56 shrink-0"
            onValueChange={setClientKey}
            options={options}
            value={clientKey}
          />
        )}
      />
      {/*
        `pt-4` 不能省：卡头带 `-mt-4`（把卡片的 `py-4` 上边距顶掉，好让卡头贴顶），
        于是 `space-y-4` 只给**第一个子元素之后**的兄弟加间距，第一块内容会直接贴着卡头下沿。
        补上和 `space-y-4` 一致的 16px，卡头与第一块内容的间距才和内容之间的一致。
      */}
      <CardContent className="space-y-4 pt-4">
        {!client ? (
          <EmptyState icon={CircleSlash} title={t('clientConfig.unknownClient')} />
        ) : error ? (
          <EmptyState icon={CircleSlash} title={t('clientConfig.loadFailed')} description={error} />
        ) : loading ? (
          // 只摆一块正文高度的骨架：这张卡的头与选择器已经就位，等的只是那几份文件。
          <div className="h-115 w-full animate-pulse rounded-xl bg-inset" />
        ) : (
          <ConfigEditorBody editor={editor} />
        )}
      </CardContent>
    </Card>
  )
}
