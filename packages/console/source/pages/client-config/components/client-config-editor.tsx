import { useState } from 'react'
import { CircleSlash, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITIONS } from '@/catalog/clients'
import { cn } from '@/lib/utils'
import { ClientIcon } from './client-icon'
import { ConfigEditorBody } from './config-editor-body'
import { useClientConfigEditor } from '../hooks/use-client-config-editor'

interface ClientConfigEditorProps {
  /** 打开时先落到哪个客户端；缺省是清单里排第一的那个。 */
  defaultClientKey?: string
  /** 卡头图标；不传就不摆图标（引导页的卡都只有标题）。 */
  icon?: React.ReactNode
}

interface ClientPickerProps {
  value: string
  onChange: (clientKey: string) => void
}

/**
 * 客户端宫格：一卡一个工具（品牌图标 + 名字），等大平铺，选中的那卡描一圈主色边。
 *
 * 用宫格而不是下拉：引导页这一步是「把刚才那条地址填进去」的落点，用户此刻要在一列工具里认出
 * 「我平时用哪个」，一张带品牌图标的卡片比一个下拉选项先对得上号——与模型的供应商宫格同一个式子。
 *
 * 一组同名原生 radio 打底：互斥、方向键可切换、`aria-checked` 与焦点语义全都正确，
 * 不必自己拿 `role="radio"` 拼一套只做对一半的键盘支持（与 `RouteModeOptionCard` 同一个理由）。
 * 名字用 `truncate`：注册表里最长的名字在窄卡片里宁可截断，也不要换行把整排卡片撑得参差不齐。
 */
function ClientPicker(props: ClientPickerProps) {
  const { value, onChange } = props
  const t = useTranslation()

  return (
    <div aria-label={t('clientConfig.selectClient')} className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
      {AGENT_CLIENT_DEFINITIONS.map(client => {
        const active = client.key === value

        return (
          <label
            key={client.key}
            className={cn(
              'flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border px-3 text-center transition-colors',
              'focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-ring',
              active
                ? 'border-state-accent-solid bg-state-accent-hover'
                : 'border-module-border hover:border-primary/40 hover:bg-state-base-hover',
            )}
          >
            <input
              type="radio"
              name="agent-client"
              className="sr-only"
              value={client.key}
              checked={active}
              onChange={() => onChange(client.key)}
            />
            <ClientIcon clientKey={client.key} size={22} />
            <span className="w-full truncate system-xs-medium text-text-primary">{client.name}</span>
          </label>
        )
      })}
    </div>
  )
}

/**
 * 「挑一个客户端、就地改它的配置」——一张自足的卡：上面一列客户端宫格，选一个，下面就是那份文件的
 * 编辑区。详情页把这块正文铺满整页，引导页「接入工具」那一步则把它整张嵌进来，让用户不必跳到另一页
 * 就能把配置改对——引导里做的动作，在正式页面里已经是生效的结果。
 *
 * 与详情页共用同一套状态（`useClientConfigEditor`）与同一块正文（`ConfigEditorBody`），
 * 差别只在这里多了一层「选哪个客户端」：详情页的身份来自路由参数（「我要看这一个」），
 * 引导页没有那个前提，得让用户自己挑。
 *
 * 客户端选择器是**宫格**（见 `ClientPicker`）而不是下拉：一张带品牌图标的卡片比一行文字先认得出来。
 *
 * 引导页这边比详情页少一步：**没有「要写入的模型」那张卡**（`ConfigEditorBody` 不传 `contentActions`
 * 之外的东西就是详情页那套）。在这一步，用户要的是「让它能用」，不是挑模型——模型一律按内置默认生成，
 * 等真用起来了再去客户端配置页按需换。于是写入动作（**生成 / 撤销 / 保存**）全收到「配置内容」那张卡的
 * 卡头上：生成据此按默认模型改写一遍（`generateConfig(false)`），用户看见结果、按下保存才落盘。
 */
export function ClientConfigEditor(props: ClientConfigEditorProps) {
  const { defaultClientKey, icon } = props
  const t = useTranslation()
  const [clientKey, setClientKey] = useState(defaultClientKey ?? AGENT_CLIENT_DEFINITIONS[0]?.key ?? '')
  const editor = useClientConfigEditor(clientKey)
  const { loading, error, client, files, activeFilePath, dirtyFilePaths, saving, saveAll, discardFile, generateConfig, generating, canGenerate } = editor

  // 生成 / 保存 / 撤销是**这张卡**的写入动作（生成改内存草稿，保存写回全部改动过的文件），
  // 一起摆在「配置内容」那张卡的卡头右边；撤销只退当前展开的那一份。
  const active = files.find(file => file.filePath === activeFilePath) ?? files[0]
  const dirtyCount = dirtyFilePaths.length

  return (
    <Card>
      <SettingsCardHeader
        icon={icon}
        title={t('clientConfig.editor.title')}
        description={t('clientConfig.editor.description')}
      />
      {/*
        `pt-4` 不能省：卡头带 `-mt-4`（把卡片的 `py-4` 上边距顶掉，好让卡头贴顶），
        于是 `space-y-4` 只给**第一个子元素之后**的兄弟加间距，第一块内容会直接贴着卡头下沿。
        补上和 `space-y-4` 一致的 16px，卡头与第一块内容的间距才和内容之间的一致。
      */}
      <CardContent className="space-y-4 pt-4">
        {/* 换客户端就是换下面那一整块：宫格常驻，读不到文件（或还在读）时也能切。 */}
        <ClientPicker onChange={setClientKey} value={clientKey} />
        {!client ? (
          <EmptyState icon={CircleSlash} title={t('clientConfig.unknownClient')} />
        ) : error ? (
          <EmptyState icon={CircleSlash} title={t('clientConfig.loadFailed')} description={error} />
        ) : loading ? (
          // 只摆一块正文高度的骨架：这张卡的头与选择器已经就位，等的只是那几份文件。
          <div className="h-115 w-full animate-pulse rounded-xl bg-inset" />
        ) : (
          // 生成 / 撤销 / 保存作为一排动作传给「配置内容」那张卡，摆在它的卡头右边；
          // 传了它就顺带关掉模型卡，一律按内置默认生成。
          <ConfigEditorBody
            editor={editor}
            contentActions={
              <>
                {/* 生成只对「有配方、能自动改写」的客户端有意义：没有配方就没有推荐内容可生成。 */}
                {canGenerate && (
                  <Button disabled={generating} variant="outline" onClick={() => generateConfig(false)}>
                    <Sparkles size={14} /> {generating ? t('clientConfig.generating') : t('clientConfig.generate')}
                  </Button>
                )}
                <Button disabled={!active?.dirty || saving} variant="outline" onClick={() => active && discardFile(active.filePath)}>
                  {t('clientConfig.discard')}
                </Button>
                <Button disabled={dirtyCount === 0 || saving} onClick={saveAll}>
                  {saving ? t('clientConfig.saving') : dirtyCount > 1 ? t('clientConfig.saveAll', { count: dirtyCount }) : t('clientConfig.saveContent')}
                </Button>
              </>
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
