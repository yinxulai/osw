import { Network } from 'lucide-react'
import { PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { INTERFACE_DESCRIPTION_KEYS, interfaceEntryName } from '@/components/interface-entries'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslation } from '@/i18n/provider'

/**
 * 「这个服务受理哪些协议」——客户端列表上面两张卡里的第二张。
 *
 * 列表只覆盖注册表里认识的工具，而接得上的工具远比这份名单多：只要客户端能配成下面任一条路径，
 * 就能接上。所以这张卡摆的是**协议**，不是我们认识的牌子——一列工具名等于替用户判断
 * 他手上的工具在不在其中（同一个规矩见引导页那张接口表）。
 *
 * 一行一条，不合并成一句话：这里要让人**逐条对照**自己客户端里的「协议 / API 类型」下拉框，
 * 摊成一行读完还是得回来数第几个是哪个。左边是协议名（本地应答的接口用中文说明兜底），
 * 右边是方法与**全部等价写法**——`/v1` 带不带这件事由这一行直接回答，不必再去读地址那行的说明。
 */
export function ProtocolCard() {
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<Network />}
        title={t('clientConfig.manual.protocol.title')}
        description={t('clientConfig.manual.protocol.description')}
      />
      {/* 行要贴到卡片边缘，所以内容区去掉留白；行与行之间只留一条发丝线。 */}
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50">
          {PROXY_INTERFACE_ENTRIES.map(entry => (
            <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5" key={entry.id}>
              <span className="system-sm-medium text-text-primary">
                {interfaceEntryName(entry) ?? t(INTERFACE_DESCRIPTION_KEYS[entry.id])}
              </span>
              <span className="ml-auto flex flex-wrap items-baseline gap-x-2 font-mono system-xs-regular text-text-secondary">
                <span className="text-text-quaternary">{entry.method}</span>
                <span>{entry.paths[0]}</span>
                {/* 等价写法排在主写法后面并压暗一级：服务端两种都受理，但用户要抄的是前一条。 */}
                {entry.paths.slice(1).map(path => (
                  <span className="text-text-quaternary" key={path}>{path}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
