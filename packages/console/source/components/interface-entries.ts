import type { ProxyInterfaceId } from '@common/protocols'
import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 「本服务受理哪些接口」这份清单在界面上的唯一入口。
 *
 * 事实来自契约层的 `PROXY_INTERFACE_ENTRIES`（代理注册表的一致性测试守着它，见
 * `packages/core/source/proxy/protocols/interface-surface.test.ts`），这里只补每行的中文说明。
 *
 * 类型写成 `Record<ProxyInterfaceId, …>` 而不是散落的对象字面量：契约层新增一个接口时，
 * 这里会编译失败，而不是让新接口在页面上默默少一行说明。
 *
 * 路径清单的渲染只有一处（`@/components/interface-table-card`）：有协议名就直接摆
 * `PROTOCOL_DISPLAY_NAMES` 里的正式叫法（`OpenAI Completions` / `Anthropic Messages` ……），
 * 因为用户要对照的是他自己客户端里的「协议 / API 类型」下拉框；不转发上游的入口
 * （`protocol === null`）才退回这里的中文说明。两个页面各写一遍「该叫什么名字」，
 * 迟早会在一处写出意译名。
 */
export const INTERFACE_DESCRIPTION_KEYS: Readonly<Record<ProxyInterfaceId, UiCatalogKey>> = {
  chatCompletions: 'access.interface.entry.chatCompletions',
  responses: 'access.interface.entry.responses',
  messages: 'access.interface.entry.messages',
  models: 'access.interface.entry.models',
}
