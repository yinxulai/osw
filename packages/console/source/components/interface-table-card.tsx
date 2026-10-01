import { ListTree } from 'lucide-react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { INTERFACE_DESCRIPTION_KEYS } from './interface-entries'
import { Card, CardContent } from './ui/card'
import { SettingsCardHeader } from './settings-card-header'
import { useTranslation } from '@/i18n/provider'

/**
 * 本服务的接口面：一张「哪些路径会被受理」的表。
 *
 * 表的内容全部来自契约层的 `PROXY_INTERFACE_ENTRIES`，那份清单由代理注册表的一致性测试守着
 * （`packages/core/source/proxy/protocols/interface-surface.test.ts`）。这是这一页敢用
 * 「说明书」形态的前提：它写的是我们自己的实现事实，不会因为谁改了界面而过期，
 * 也不需要在这里维护第二份路径清单。
 *
 * **两个页面共用这一份实现**（引导第二步、客户端配置页），且都不再收起：这是一张参考卡，
 * 用户来这一步就是为了看它，摆出「点一下才能看」只会白多一步。
 *
 * 页面上**不列任何工具的名字**：工具的产品名、菜单路径、字段叫法都由别人定义、随时会变，
 * 追着它们更新等于把维护成本建在别人的排期上。这里只回答「服务对外长什么样」，
 * 用户拿这些事实去对任何一种客户端都成立。
 *
 * 表里只列**会被转发给上游的接口**，两条被有意拿掉：
 *
 * - `GET /v1/models`（`protocol` 为 `null` 的那条）由本地直接应答、不转发上游，也不是
 *   「接上没接上」的证据，摆在这里只会被误读成「接口就这几个」。用 `protocol !== null`
 *   过滤掉它，`INTERFACE_DESCRIPTION_KEYS` 里对应的说明也就不再需要。
 * - 每条接口的**等价写法**（不带 `/v1`）不铺第二列：服务端两种写法都受理，这件事写在卡头
 *   那句说明里；逐行列出来读起来像是要用户去挑一条，反倒把唯一的正解淹了。所以只取
 *   `entry.paths[0]`（带 `/v1` 的主写法）。
 */
export function InterfaceTableCard() {
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<ListTree />}
        title={t('access.interface.title')}
        description={t('access.interface.description')}
      />
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {PROXY_INTERFACE_ENTRIES.filter(entry => entry.protocol !== null).map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="w-9 shrink-0 font-mono system-2xs-medium text-text-tertiary">
                {entry.method}
              </span>
              <span className="font-mono system-sm-medium text-text-primary">{entry.paths[0]}</span>
              <span className="ml-auto flex flex-wrap items-baseline gap-x-2">
                <span className="system-xs-regular text-text-tertiary">
                  {t(INTERFACE_DESCRIPTION_KEYS[entry.id])}
                </span>
                <span className="system-2xs-regular text-text-quaternary">
                  {entry.protocol ? PROTOCOL_DISPLAY_NAMES[entry.protocol] : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
