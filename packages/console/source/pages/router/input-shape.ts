import type { UiCatalogKey } from '@common/i18n/catalogs'
import { PATH_WILDCARD_SUFFIX, type SchemaValueType } from '@common/router/types'

/** 输入节点声明的一条字段：路径 + 静态类型（带说明的附上说明键）。 */
export interface InputNodeField {
  path: string
  valueType: SchemaValueType
  noteKey?: UiCatalogKey
}

/**
 * 输入节点交给下游的字段。
 *
 * 全是**不解析请求体就能知道**的东西：请求行、请求头、请求体整体，
 * 以及调用方自带的 `metadata`（内容由调用方定义，引擎只读不写）。
 * 请求体里有什么字段、是什么格式（JSON 对象？字节流？）是**协议**的事，
 * 只有协议发现节点知道 —— 见 `@common/router/request-shape`。
 *
 * 这份清单是唯一来源：字段候选表（`field-hints.ts`）与节点配置面板
 * （`panel/input-panel.tsx`）都读它，所以面板上列的就是下游真正能选的。
 *
 * 逻辑模型列表是**运行时注入**的：任何静态示例里都不可能有它，
 * 所以这组通配投影只能显式给出，否则默认策略里的 `logicalModels[*].modelId`
 * 在「比较字段」下拉里根本选不到。
 */
export const INPUT_NODE_FIELDS: readonly InputNodeField[] = [
  { path: 'request.path', valueType: 'string', noteKey: 'router.fieldNote.requestPath' },
  { path: 'request.method', valueType: 'string', noteKey: 'router.fieldNote.requestMethod' },
  { path: 'request.headers', valueType: 'object', noteKey: 'router.fieldNote.requestHeaders' },
  { path: 'request.body', valueType: 'object', noteKey: 'router.fieldNote.requestBody' },
  { path: 'metadata', valueType: 'object', noteKey: 'router.fieldNote.metadata' },
  { path: 'logicalModels', valueType: 'array', noteKey: 'router.fieldNote.logicalModels' },
  { path: `logicalModels${PATH_WILDCARD_SUFFIX}.modelId`, valueType: 'string' },
  { path: `logicalModels${PATH_WILDCARD_SUFFIX}.enabled`, valueType: 'boolean' },
]
