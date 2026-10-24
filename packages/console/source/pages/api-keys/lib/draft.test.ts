import { describe, expect, it } from 'vitest'
import type { ApiKeyRow } from '../types'
import { apiKeyToDraft, draftExpiresTime, emptyApiKeyDraft, toDateInput } from './draft'

/*
 * 日期串与时间戳的互转。
 *
 * 两条边界最容易出错，而且都只在真实用户手上体现：选「今天」不该立刻过期，
 * 显示时不该因为时区偏移而差一天。它们住在纯函数里就是为了能被这样钉住。
 */

function rowOf(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'ak_1',
    name: 'Alpha',
    enabled: true,
    keyReference: 'key_1',
    expiresTime: null,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
    status: 'enabled',
    ...overrides,
  }
}

describe('draftExpiresTime', () => {
  it('空串读作永不过期', () => {
    expect(draftExpiresTime('')).toBeNull()
  })

  it('取当天结束时刻，选了今天不会立刻过期', () => {
    const value = draftExpiresTime('2026-01-31')

    expect(value).not.toBeNull()
    const date = new Date(value as number)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(0)
    expect(date.getDate()).toBe(31)
    expect(date.getHours()).toBe(23)
    expect(date.getMinutes()).toBe(59)
  })
})

describe('toDateInput', () => {
  it('null 读作空串，而不是被格式化成一个 1970 年', () => {
    expect(toDateInput(null)).toBe('')
  })

  it('往返一致：本地日期不因时区偏移差一天', () => {
    for (const value of ['2026-01-31', '2026-06-15', '2026-12-31']) {
      expect(toDateInput(draftExpiresTime(value))).toBe(value)
    }
  })
})

describe('emptyApiKeyDraft', () => {
  it('新建时是一份干净的草稿：无名字、启用、永不过期', () => {
    expect(emptyApiKeyDraft()).toEqual({ name: '', enabled: true, expiresDate: '' })
  })
})

describe('apiKeyToDraft', () => {
  it('过期的那把回填成停用，避免用户以为它还在生效', () => {
    expect(apiKeyToDraft(rowOf({ status: 'expired' })).enabled).toBe(false)
  })

  it('带过期时间的回填成日期串，永不过期的回填成空串', () => {
    expect(apiKeyToDraft(rowOf()).expiresDate).toBe('')
    expect(apiKeyToDraft(rowOf({ expiresTime: draftExpiresTime('2026-01-31') })).expiresDate).toBe('2026-01-31')
  })
})
