import { describe, expect, it } from 'vitest'
import type { ApiError } from '@common/schemas'
import { getTranslator } from '@/i18n/active'
import { ApiRequestError, localizeError, localizeErrorCode } from './errors'

// `@/i18n/active` 与 `@common/i18n/catalogs` 共用同一个模块级实例，
// 所以先切到中文，`tryTranslate` / `localizeError` 才会真的走中文目录。
const t = getTranslator('zh-CN')

function apiError(overrides: Partial<ApiError> = {}): ApiError {
  return { success: false, errorCode: 'NOT_FOUND', errorMessage: 'provider not found: prov_x', ...overrides }
}

describe('localizeErrorCode', () => {
  // 目录里有这个码就按码取文案：服务端的英文诊断（`provider not found: prov_x`）
  // 不是给人看的句子，它只留给日志。
  it('按错误码取界面文案', () => {
    expect(localizeErrorCode('NOT_FOUND', 'provider not found')).toBe('资源不存在')
  })

  // 服务端先上线新错误码的那段时间里，界面必须还能说出事实——
  // 退回「未知错误」会把「供应商不存在：prov_x」这句话直接丢掉。
  it('目录里没有这个码时退回英文诊断原文', () => {
    expect(localizeErrorCode('SOME_FUTURE_CODE', 'something specific happened'))
      .toBe('something specific happened')
  })

  it('带插值的错误码用 errorParams 填模板', () => {
    expect(localizeErrorCode('PROVIDER_MODEL_DISABLED', 'disabled', { modelName: 'gpt-4o' }))
      .toBe('模型「gpt-4o」已在模型管理中被停用：请先在模型管理里启用它，再打开这个绑定')
  })

  // 漏传插值参数时占位符保留原样，而不是变成 `undefined`：这样漏传在界面上看得见。
  it('插值参数缺失时保留占位符', () => {
    expect(localizeErrorCode('PROVIDER_MODEL_DISABLED', 'disabled')).toContain('{modelName}')
  })
})

describe('ApiRequestError', () => {
  it('message 是已经本地化的界面文案，诊断原文另存一份', () => {
    const error = new ApiRequestError(apiError())
    expect(error.message).toBe('资源不存在')
    expect(error.errorCode).toBe('NOT_FOUND')
    expect(error.diagnosticMessage).toBe('provider not found: prov_x')
    expect(error.name).toBe('ApiRequestError')
  })

  it('保留 errorParams，调用方还能自己再拼一次', () => {
    const params = { modelName: 'gpt-4o' }
    const error = new ApiRequestError(apiError({ errorCode: 'PROVIDER_MODEL_DISABLED', errorParams: params }))
    expect(error.errorParams).toEqual(params)
  })

  // 必须是 Error 子类：现状里大量 `catch (error) { toast.error(error.message) }`
  // 靠的就是这一点。
  it('是个 Error，所以能被既有 catch 分支直接当异常处理', () => {
    expect(new ApiRequestError(apiError())).toBeInstanceOf(Error)
  })
})

describe('localizeError', () => {
  it('API 错误直接用它的界面文案', () => {
    expect(localizeError(t, new ApiRequestError(apiError()))).toBe('资源不存在')
  })

  // 不是 API 错误时（渲染层自己抛的），异常自带的 message 比一句「未知错误」有用得多。
  it('普通异常用它自己的 message', () => {
    expect(localizeError(t, new Error('boom'))).toBe('boom')
  })

  it('抛出非异常值、或异常没有 message 时才说「未知错误」', () => {
    expect(localizeError(t, 'a string')).toBe('未知错误')
    expect(localizeError(t, new Error(''))).toBe('未知错误')
    expect(localizeError(t, null)).toBe('未知错误')
  })
})
