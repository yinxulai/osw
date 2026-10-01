import { z } from 'zod'
import { CLIENT_REQUEST_ABORTED, CLIENT_REQUEST_ABORTED_MESSAGE } from '@common/error-codes'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import type { ApiErrorCode, Protocol } from '@common/schemas'

/**
 * 服务端错误码就是 §`ApiErrorCodeSchema` 那一套：
 * 渲染进程靠 `errorCode` 做本地化，所以两边不能各维护一份名单，否则新增错误码时
 * 只有一边知道，用户就会看到一句没翻译的英文原文。
 */
export type ErrorCode = ApiErrorCode

type AppErrorOptions = { expose?: boolean; cause?: unknown; details?: unknown }

export class AppError extends Error {
  readonly name = 'AppError'
  readonly expose: boolean
  readonly details?: unknown

  constructor(readonly code: ErrorCode, readonly statusCode: number, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.expose = options.expose ?? true
    this.details = options.details
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof z.ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      400,
      error.errors.map(issue => issue.message).join('; '),
      { cause: error },
    )
  }

  // 取消是调用方主动结束，不是故障，用固定的哨兵文本识别（见 proxy 执行层）。
  if (error instanceof Error && error.message === CLIENT_REQUEST_ABORTED_MESSAGE) {
    return new AppError(CLIENT_REQUEST_ABORTED, 499, 'Client aborted the request', { cause: error })
  }

  // 唯一约束冲突是**可修正的输入问题**，不是服务端故障。放在这里统一翻译，是因为
  // 「先查后写」的预检在任何一条写路径上都隔着一段窗口，兜底必须在最后一道口收口
  // （见 `translateSqliteUniqueViolation` 的说明）。
  const constraint = translateSqliteUniqueViolation(error)
  if (constraint) return constraint

  return new AppError('INTERNAL_ERROR', 500, 'Internal server error', {
    expose: false,
    cause: error,
  })
}

export function getErrorResponseMessage(error: AppError, fallback: string): string {
  return error.expose ? error.message : fallback
}

/** 可安全序列化、供界面拼本地化文案的参数。 */
export type ErrorParams = Record<string, string | number>

/**
 * 从 `details` 里挑出**值本身可序列化**的字段作为 `errorParams`。
 *
 * 不做递归、不序列化对象：界面只会把参数插进一句本地化文案里，
 * 传嵌套结构没有用途，反而会把内部对象结构泄到响应体上。
 */
export function getErrorParams(error: AppError): ErrorParams | undefined {
  if (!error.expose || !error.details || typeof error.details !== 'object') return undefined
  const entries = Object.entries(error.details as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
  return entries.length > 0 ? Object.fromEntries(entries) as ErrorParams : undefined
}

export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof AppError && error.code === code
}

/**
 * 「这个协议没有可用的上游地址」。
 *
 * 供应商与模型两层都没地址时必须**报错**，不能编一个占位地址顶上：占位值会被当成用户自己
 * 配的地址展示在供应商配置里、被模型列表探测、被真实请求打出去，而用户看到的只是一串自己
 * 没写过的 URL —— 完全不知道问题出在哪。
 *
 * 供应商名与协议展示名作为 `errorParams` 出去，界面按 `errors.ENDPOINT_URL_MISSING` 拼文案；
 * 服务端自己那句只是给日志与外部工具看的英文诊断。
 */
export function endpointUrlMissingError(providerName: string, protocols: readonly Protocol[]): AppError {
  return new AppError(
    'ENDPOINT_URL_MISSING',
    400,
    `Provider ${providerName} has no upstream url for ${protocols.join(', ')}`,
    { details: { providerName, protocols: protocols.map(protocol => PROTOCOL_DISPLAY_NAMES[protocol]).join(', ') } },
  )
}

/**
 * 「这个协议还有模型在用，不能就这么撤掉」。
 *
 * 端点行的 `enabled` 是协议级开关（读取侧要求它为 true），所以把供应商那一层的地址清空或停用，
 * 等于把该协议从所有正挂着它的模型上一起撤掉——**哪怕模型自己在绑定上写了地址也一样**。
 * 用户以为自己只改了供应商配置，实际却让一批模型没法用了，而且界面上没有任何提示。
 *
 * 所以这里同样在事务里拒绝，把「哪些模型在用」一并说清楚，让用户自己决定是先给模型填地址
 * 还是保留这个地址。与 `endpointUrlMissingError` 分开成两个错误码，是因为两边的下一步动作不同：
 * 那边要去**补**地址，这边要先去**拆**依赖（或放弃这次修改）。
 */
export function endpointUrlInUseError(providerName: string, protocols: readonly Protocol[], modelNames: readonly string[]): AppError {
  return new AppError(
    'ENDPOINT_URL_IN_USE',
    400,
    `Provider ${providerName} still has models on ${protocols.join(', ')} (${modelNames.length}): ${modelNames.join(', ')}`,
    {
      details: {
        providerName,
        protocols: protocols.map(protocol => PROTOCOL_DISPLAY_NAMES[protocol]).join(', '),
        count: modelNames.length,
        models: modelNames.join(', '),
      },
    },
  )
}

/**
 * 「模型本体被全局停用了，这个绑定不许打开」。
 *
 * 绑定开关（`scheduling_policies.enabled`）与模型本体开关（`provider_models.enabled`）是两件事，
 * 但调度只看后者：`getAvailableModels` 要求模型本体也是启用的。所以允许把一个停用模型的绑定
 * 打开，只会得到「界面说它待命、请求却永远不落到它上面」——正是 PR #13 修掉的那类症状。
 *
 * 因此这里直接拒绝，而不是静默把绑定改成停用：用户点的是「打开」，得到一次明确的解释比
 * 开关自己弹回去更好懂。界面侧同时把这个开关置灰，这里是兜底（含并发与其它调用方）。
 */
export function providerModelDisabledError(modelName: string): AppError {
  return new AppError(
    'PROVIDER_MODEL_DISABLED',
    400,
    `Provider model ${modelName} is disabled and cannot be enabled in a logical model`,
    { details: { modelName } },
  )
}

/**
 * 「这个模型 id 已经被占用了」。
 *
 * `modelId` 是逻辑模型对外的唯一身份（请求里的模型名就是它，活跃行之间由部分唯一索引保证），
 * 所以重名不是「换个名字」而是「要一个已经被人拿走的身份」——只能拒绝。
 * 400 与 500 的差别在这里很实在：这是用户可修正的输入问题（换个模型 id，或者先把原来那个
 * 删掉/改名），不是服务端故障，把它的 `errorCode` 暴露出去，界面才能把「哪个模型 id 撞了」
 * 说清楚，而不是给一句没有上下文的「内部错误」。
 *
 * 数据记录 id 不会走到这里：它由服务端生成。
 */
export function duplicateLogicalModelError(modelId: string): AppError {
  return new AppError(
    'DUPLICATE_RESOURCE',
    409,
    `Logical model ${modelId} already exists`,
    { details: { modelId } },
  )
}

/** 「没有这个逻辑模型」。读、改、删共用同一个说法；`id` 是**数据记录 id**。 */
export function logicalModelNotFoundError(id: string): AppError {
  return new AppError(
    'RESOURCE_NOT_FOUND',
    404,
    `Logical model ${id} not found`,
    { details: { id } },
  )
}

/**
 * 「内建默认逻辑模型不能删、也不能改名」。
 *
 * 它是所有兜底落点的归宿：请求没命中任何逻辑模型时落到这里，删掉它等于让代理没有可用的上游
 * 起点。用户能改的是它的说明与开关。参数是它的 **modelId**（内建默认模型认的是模型 id，
 * 因为数据记录 id 是本机生成的、不能参与这个判断）。
 */
export function protectedLogicalModelError(modelId: string): AppError {
  return new AppError(
    'RESOURCE_CONFLICT',
    409,
    `Logical model ${modelId} is built in and cannot be deleted or renamed`,
    { details: { modelId } },
  )
}

/**
 * 「这个供应商下已经有一条同协议的活跃端点了」。
 *
 * 这条规则由应用层守（见 `config-schema.ts`：删掉的行让位，因此没有部分唯一索引可用）——
 * 命中就是用户可修正的输入问题（换个协议，或者先把那条删掉），
 * 用 409 + `DUPLICATE_RESOURCE` 说清楚，不要让它变成两条同协议行里随缘读到一条。
 */
export function duplicateProviderEndpointError(protocol: string): AppError {
  return new AppError(
    'DUPLICATE_RESOURCE',
    409,
    `This provider already has an endpoint for protocol ${protocol}`,
    { details: { protocol } },
  )
}

/**
 * 「同一个身份已经有一条活跃行了」。
 *
 * 给那些不再由数据库唯一索引把关、改由 store 预检的绑定类关系（模型↔端点的绑定、
 * 绑定↔客户端协议的转换器）用。它们的规则都是「同一对关系只留一条活跃行」，
 * 违反它的是用户可修正的输入（先解绑再加回来，或者换一个协议），所以是 409 而不是 500。
 */
export function duplicateActiveResourceError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('DUPLICATE_RESOURCE', 409, message, { details })
}

/** 「没有这个资源」。参数是给日志与外部工具看的那句英文诊断里的标识（id 或名字）。 */
export function resourceNotFoundError(resource: string, identifier: string): AppError {
  return new AppError(
    'RESOURCE_NOT_FOUND',
    404,
    `${resource} ${identifier} not found`,
    { details: { resource, identifier } },
  )
}

/**
 * 「这一条改写规则已经绑过了」。`replaceProviderModelRequestRewriteRuleBindings` 收的是整份
 * 绑定表，重复的 `ruleId` 说明请求体自己前后矛盾；`priority` 重复则撞上
 * `(providerModelId, priority)` 的部分唯一索引，两条都是用户可修正的输入，不是 500。
 */
export function duplicateRequestRewriteRuleBindingError(kind: 'rule' | 'priority'): AppError {
  return new AppError(
    'DUPLICATE_RESOURCE',
    409,
    `A request rewrite rule with the same binding and priority already exists (duplicate ${kind})`,
    { details: { kind } },
  )
}

/** `node:sqlite` 的约束冲突错误码：`errstr` 是 `SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT`。 */
const SQLITE_UNIQUE_VIOLATION = 2067

function readSqliteError(error: unknown): { errcode: number; message: string } | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { code?: unknown; errcode?: unknown; message?: unknown }
  if (candidate.code !== 'ERR_SQLITE_ERROR' || typeof candidate.errcode !== 'number') return null
  return { errcode: candidate.errcode, message: typeof candidate.message === 'string' ? candidate.message : '' }
}

/**
 * 把裸的 SQLite 唯一约束冲突翻译成用户看得懂的错误。
 *
 * 为什么不指望调用方「每次都先查一遍」：先查后写之间永远有一段窗口（同一个进程里两个
 * 异步写、两个管理页签、导入文件与手改同时发生），窗口里插进去的那一行只有数据库自己知道。
 * 于是 `INSERT` 直接抛 `SQLITE_CONSTRAINT_UNIQUE`，`normalizeError` 判不出来源，回给界面的
 * 就是一句「Internal server error」（HTTP 500）——用户明明只是填重了一个名字。
 *
 * 这里要守的规则已经很少：这条链上凡是有用户名字的资源都改成「身份是记录 id、名字只写在应用层」，
 * 唯一还真会来撞的只剩客户端配置快照的 `(clientKey, filePath, contentHash)`。
 * 于是**不按表名分支**，一律给同一句可本地化的 409：多一个分支就要多维护一个永远不会走到的分支，
 * 而「哪里撞了」直接附带在 `details.constraint` 里，界面要用再去读。读不出来就原样放行，
 * 让 `normalizeError` 按未知错误处理——宁可 500，也不要给一个编造的「哪里重了」。
 */
export function translateSqliteUniqueViolation(error: unknown): AppError | null {
  const sqlite = readSqliteError(error)
  if (!sqlite || sqlite.errcode !== SQLITE_UNIQUE_VIOLATION) return null
  // 消息形如 `UNIQUE constraint failed: client_config_versions.clientKey, ...`
  const columns = sqlite.message.split(':').slice(1).join(':').trim()
  return new AppError('DUPLICATE_RESOURCE', 409, `A resource with the same identity already exists (${columns})`, { cause: error, details: { constraint: columns } })
}
