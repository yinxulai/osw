import { LogicalModelIdSchema } from '@common/schemas'

/**
 * 逻辑模型表单的校验与拼装规则。
 *
 * 抽成纯函数是因为它是**领域规则**，不是渲染细节：模型名不只是一个标签，它同时是
 * 请求里 `model` 字段的取值——写错这个名字，这个逻辑模型就会从请求那一侧直接消失。
 * 这条规则此前写在两个对话框的 `submit` 里，各一份；要改的时候得记住有两处。
 */

/** 模型名的问题。`required` 与 `invalid` 分开，是为了让两个对话框各自给出自己的文案。 */
export type LogicalModelIdIssue = 'required' | 'invalid'

/** 校验选项。`builtIn` 的模型名是兜底匹配的依据，不允许改，因此跳过校验。 */
export interface ValidateLogicalModelIdOptions {
  builtIn?: boolean
}

/** 校验模型名。 */
export function validateLogicalModelId(modelId: string, options: ValidateLogicalModelIdOptions = {}): LogicalModelIdIssue | null {
  if (options.builtIn) return null
  const trimmed = modelId.trim()
  if (!trimmed) return 'required'
  if (!LogicalModelIdSchema.safeParse(trimmed).success) return 'invalid'
  return null
}

/** 新建与编辑共用的可编辑字段。 */
export interface LogicalModelFormInput {
  modelId: string
  description: string
}

/** 新建的请求体。`description` 允许为空，模型名已经去空白。 */
export function buildCreateLogicalModelInput(input: LogicalModelFormInput) {
  return { modelId: input.modelId.trim(), description: input.description.trim() }
}

/**
 * 编辑的请求体。
 *
 * `modelId` 只在允许改名时才带上：内建默认逻辑模型的模型名不能被改，多发一个同名字段
 * 会让服务端以为这是一次重命名；而两个字段一并发出去也不是图省事——改名不只是一列
 * UPDATE，服务端要在同一次事务里把引用它的路由落点与条件值一起搬走，拆成两个请求就会
 * 出现「名字改了、落点没跟上」的中间态。
 */
export function buildUpdateLogicalModelInput(input: LogicalModelFormInput, options: ValidateLogicalModelIdOptions = {}) {
  return {
    ...(options.builtIn ? {} : { modelId: input.modelId.trim() }),
    description: input.description.trim(),
  }
}
