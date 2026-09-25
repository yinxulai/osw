import { PROTOCOL_DISPLAY_NAMES, type ProxyInterfaceEntry, type ProxyInterfaceId } from '@common/protocols'
import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 「本服务受理哪些接口」这份清单在界面上的唯一入口。
 *
 * 事实来自契约层的 `PROXY_INTERFACE_ENTRIES`（代理注册表的一致性测试守着它，见
 * `packages/core/source/proxy/protocols/interface-surface.test.ts`），这里只补两样东西：
 * 每行的中文说明，以及「这一行该叫什么名字」。
 *
 * 类型写成 `Record<ProxyInterfaceId, …>` 而不是散落的对象字面量：契约层新增一个接口时，
 * 这里会编译失败，而不是让新接口在页面上默默少一行说明。
 *
 * **名字优先用协议名。** 有上游协议的入口直接摆 `PROTOCOL_DISPLAY_NAMES` 里的正式叫法
 * （`OpenAI Completions` / `Anthropic Messages` ……），因为用户要对照的是他自己客户端里的
 * 「协议 / API 类型」下拉框，那里写的就是这个名字；只有不转发给上游的入口
 * （`protocol === null`，本地应答）才退回中文说明。所以这里导出的是取名字的函数，
 * 而不是另一张写死名字的表——写死一张，`PROXY_INTERFACE_ENTRIES` 一改就漂。
 */
export const INTERFACE_DESCRIPTION_KEYS: Readonly<Record<ProxyInterfaceId, UiCatalogKey>> = {
  chatCompletions: 'access.interface.entry.chatCompletions',
  responses: 'access.interface.entry.responses',
  messages: 'access.interface.entry.messages',
  models: 'access.interface.entry.models',
}

/**
 * 一行接口的协议名；本地应答的入口（不转发上游）没有协议名，返回 `null`。
 *
 * 调用方拿到 `null` 时退回 `INTERFACE_DESCRIPTION_KEYS` 里那句中文说明。
 * 协议名不进翻译目录（它是对外的正式叫法，见 `@common/protocols`），
 * 所以这里返回的字符串由调用方直接渲染，不再经过 `t()`。
 */
export function interfaceEntryName(entry: ProxyInterfaceEntry): string | null {
  return entry.protocol ? PROTOCOL_DISPLAY_NAMES[entry.protocol] : null
}
