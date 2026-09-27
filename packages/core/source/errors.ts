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
