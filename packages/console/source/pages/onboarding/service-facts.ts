import { CLIENT_CONFIG_SAMPLE_API_KEY } from '@common/client-config'
import type { ProxyInterfaceId } from '@common/protocols'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'

/**
 * 这一页要展示的内容数据。
 *
 * 页面不生产事实，只把既有的事实摆出来，所以这里只有两样东西：
 *
 * 1. 两个**照抄用的值**。都不是密钥：OSW 不向下签发调用方凭证，本地服务也不校验鉴权，
 *    那两样东西只在转发时被换成渠道自己的密钥，所以给一个固定值让用户照抄，
 *    比让他自己编一个更省事。模型名直接引用契约层的
 *    `BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME`——它就是兜底逻辑模型的名字，不在这里抄第二遍；
 *    服务受理任意非空模型名（模型名只是路由的输入），这个值只是「不知道填什么就填它」的那一个。
 * 2. 接口表每一行的说明文案 key。接口清单本身来自契约层（`@common/protocols` 的
 *    `PROXY_INTERFACE_ENTRIES`，由代理注册表的一致性测试守着），这里只补中文说明。
 *    类型写成 `Record<ProxyInterfaceId, …>` 而不是散落的对象字面量：契约层新增一个接口时，
 *    这里会编译失败，而不是让新接口在表里默默少一行说明。
 */
export const SAMPLE_API_KEY = CLIENT_CONFIG_SAMPLE_API_KEY

export const SAMPLE_MODEL_NAME = BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME

export const INTERFACE_DESCRIPTION_KEYS: Readonly<Record<ProxyInterfaceId, UiCatalogKey>> = {
  chatCompletions: 'access.interface.entry.chatCompletions',
  responses: 'access.interface.entry.responses',
  messages: 'access.interface.entry.messages',
  models: 'access.interface.entry.models',
}
