import { describe, expect, it, vi } from 'vitest'
import type { RuntimeEnvironment } from '@common/runtime-profile'
import { mockResponse } from '../test-support'
import { isManagementPathAllowed, rejectDisallowedEnvironmentPath } from './environment-guard'

/*
 * 环境门禁。
 *
 * 只有一条路径受它约束：`/api/development/seed`（造演示数据）。它必须**在任何环境下都能被
 * 判定**，而不是靠路由自己记得判断——路由忘了判，生产实例就会被人一键灌满演示数据。
 */

const ENVIRONMENTS: RuntimeEnvironment[] = ['development', 'production']

describe('isManagementPathAllowed', () => {
  it('development 下 seed 路径放行', () => {
    expect(isManagementPathAllowed('/api/development/seed', 'development')).toBe(true)
  })

  it('production 下 seed 路径被拦（演示数据不该进正式实例）', () => {
    expect(isManagementPathAllowed('/api/development/seed', 'production')).toBe(false)
  })

  it('其它路径两种环境都放行（门禁只管这一条）', () => {
    const paths = ['/api/provider/list', '/api/logical-model/create', '/api/development/seed/extra', '/api/development', '/']
    for (const environment of ENVIRONMENTS) {
      for (const path of paths) {
        expect(isManagementPathAllowed(path, environment)).toBe(true)
      }
    }
  })

  it('比对的是完整路径，带查询串不会误判', () => {
    // 路由拿到的是 `new URL(...).pathname`，所以这里传进来的也是纯路径；
    // 这条断言锁的是「不会被 `startsWith` 之类的宽松判断放过」。
    expect(isManagementPathAllowed('/api/development/seed/', 'production')).toBe(true)
  })
})

describe('rejectDisallowedEnvironmentPath', () => {
  it('回 404 + NOT_FOUND，正文里带上被判定的路径', () => {
    const res = mockResponse()

    rejectDisallowedEnvironmentPath(res, '/api/development/seed')

    expect(res.statusCode).toBe(404)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    const end = res.end as ReturnType<typeof vi.fn>
    expect(JSON.parse(end.mock.calls[0][0] as string)).toEqual({
      success: false,
      errorCode: 'NOT_FOUND',
      errorMessage: 'API path not found: /api/development/seed',
      errorParams: { path: '/api/development/seed' },
    })
  })

  it('用 404 而不是 403：不向调用方确认「这条路径存在，只是不给你用」', () => {
    const res = mockResponse()

    rejectDisallowedEnvironmentPath(res, '/api/development/seed')

    expect(res.statusCode).toBe(404)
  })

  it('响应已写完时不覆盖（与出口的幂等约定一致）', () => {
    const res = mockResponse({ writableEnded: true })

    rejectDisallowedEnvironmentPath(res, '/api/development/seed')

    expect(res.end).not.toHaveBeenCalled()
  })
})
