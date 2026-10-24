import { logicalModelApi, schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import type { LogicalModelFormInput } from './logical-model-form'

/** 编辑请求体：`modelId` 可选，因为内建模型的模型名不让改。 */
type UpdateLogicalModelInput = { modelId?: string; description: string }

/**
 * 逻辑模型的写入动作：新建、改名改说明、删绑定、删模型。
 *
 * 它们此前一个个写在 `page.tsx` 与两个对话框的 `submit` 里，每处都自带一套 `unwrap`
 * 加 toast。抽到领域层之后，**谁在什么时候刷新列表**由调用方决定，这里只负责把那次
 * 请求发对。
 */

/** 新建一个逻辑模型。`modelId` 是模型名（请求里 `model` 字段的取值），不是数据记录 id。 */
export async function createLogicalModel(input: LogicalModelFormInput) {
  return unwrap(logicalModelApi.create(input))
}

/**
 * 改一个逻辑模型的模型名与说明。
 *
 * `id` 是**数据记录 id**——它是路径上的那个 `id`，不进请求体。改名与改说明在服务端是
 * 同一次事务（理由见 `buildUpdateLogicalModelInput` 的注释），所以这里只发一个请求。
 */
export async function updateLogicalModel(id: string, input: UpdateLogicalModelInput) {
  return unwrap(logicalModelApi.update(id, input))
}

/**
 * 删掉一个逻辑模型。软删除：服务端只打时间戳，历史请求日志仍按 `modelId` 引用它，
 * 因此界面这一侧只需要把列表刷掉。
 */
export async function removeLogicalModel(id: string) {
  return unwrap(logicalModelApi.remove(id))
}

/** 把一个供应商模型从这个逻辑模型的调度绑定里移除。只删绑定，不删模型本体。 */
export async function removeProviderModelBinding(logicalModelId: string, providerModelId: string) {
  return unwrap(schedulingPolicyApi.remove(logicalModelId, providerModelId))
}
