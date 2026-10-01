import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { SchemaValueType } from '@common/router/types'

/** 逻辑模型选择节点交给下游的一条字段：路径 + 静态类型 + 说明键。 */
export interface ModelSelectOutputField {
  path: string
  valueType: SchemaValueType
  noteKey: UiCatalogKey
}

/**
 * 逻辑模型选择节点交给下游的字段。
 *
 * 这个节点只交出**决策结果**，不产出模型回复 —— 真正的模型调用由代理按 `route.modelIds`
 * 里的逻辑模型配置完成（见 `apps/docs/product/route-design.md` §2.6 的输出契约：由路由自身产生的
 * 数据一律写在 payload 顶层的 `route` 下，调用方的 `metadata` 引擎只读不写）。
 *
 * 两条字段都是**无条件**产出的，不随取值来源变：`route.modelIds` 是落点列表（空数组表示这次
 * 没选出落点），`route.fallback` 标记这次落点是不是来自兜底列表。少了 `route.fallback`，
 * 「取值字段落空」与「取值字段恰好选中了兜底里那个模型」在图里就分不开。
 *
 * 这份清单是唯一来源：字段候选表（`field-hints.ts`）与节点配置面板
 * （`panel/model-select-panel.tsx`）都读它，所以面板上列的就是下游真正能选的。
 */
export const MODEL_SELECT_OUTPUT_FIELDS: readonly ModelSelectOutputField[] = [
  { path: 'route.modelIds', valueType: 'array', noteKey: 'router.fieldNote.modelIds' },
  { path: 'route.fallback', valueType: 'boolean', noteKey: 'router.fieldNote.modelFallback' },
]
