/**
 * 管理 API 失败的统一错误类型与错误码本地化。
 *
 * 契约见 `apps/docs/specs/i18n.md` §5：
 * - 服务端只输出**英文**诊断消息；
 * - `errorCode` 是机器契约，界面按它取本地化文案；
 * - `errorParams` 携带模板插值所需的值，避免服务端拼句子。
 */

import type { ApiError } from '@common/schemas'
import type { TranslateParams } from '@common/i18n'
import { tryTranslate, type AppTranslator } from '@/i18n/active'

/**
 * 管理 API 调用失败。
 *
 * `message` 是**已经本地化**的界面文案，所以既有的 `toast.error(error.message)` 不需要逐个改写；
 * `diagnosticMessage` 保留服务端的英文原文，只给日志与「复制详情」用。
 */
export class ApiRequestError extends Error {
  readonly errorCode: string
  readonly errorParams?: TranslateParams
  readonly diagnosticMessage: string

  constructor(error: ApiError) {
    super(localizeErrorCode(error.errorCode, error.errorMessage, error.errorParams))
    this.name = 'ApiRequestError'
    this.errorCode = error.errorCode
    this.errorParams = error.errorParams
    this.diagnosticMessage = error.errorMessage
  }
}

/**
 * 按错误码取界面文案；目录里没有这个码时退回英文诊断原文。
 *
 * 退回原文而不是「未知错误」：原文至少说清了事实（「供应商不存在：prov_x」），
 * 而且服务端先上线新错误码时界面不会集体退化成一句废话。
 */
export function localizeErrorCode(errorCode: string, diagnosticMessage: string, params?: TranslateParams): string {
  return tryTranslate(`errors.${errorCode}`, params) ?? diagnosticMessage
}

/** 把任意异常转成可以直接展示的界面文案。 */
export function localizeError(t: AppTranslator, error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error && error.message) return error.message
  return t('common.label.unknownError')
}
