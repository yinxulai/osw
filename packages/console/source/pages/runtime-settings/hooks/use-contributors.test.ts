// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPOSITORY_SLUG } from '@/lib/external-links'
import { createQueryFixture } from '@/test-support'
import { contributorKeys, useContributors } from './use-contributors'

/*
 * 设置页的贡献者头像墙。
 *
 * 这是一块「坏了也不能影响主流程」的装饰性数据，凡是写这类数据都得守住两条：
 *  - 接口失败/离线/被限流一律退化成**空数组**，不能把设置页变成错误页；
 *  - 失败不重试、成功缓存一小时 —— 不带 token 的 GitHub 公开接口每小时只有 60 次配额，
 *    重试只会让情况更糟。
 */

const fetchMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)

const endpoint = `https://api.github.com/repos/${REPOSITORY_SLUG}/contributors?per_page=100`

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('请求', () => {
  it('请求公开贡献者接口，并显式声明只接受 GitHub 的 JSON 媒体类型', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))

    const { wrapper } = createQueryFixture()
    renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(fetchMock.mock.calls[0][0]).toBe(endpoint)
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Accept: 'application/vnd.github+json' } })
    // 只读的公开仓库信息，不该为它引入凭据。
    expect(JSON.stringify(fetchMock.mock.calls[0][1])).not.toContain('Authorization')
  })

  it('查询键带上仓库名，避免和其它 GitHub 数据串味', () => {
    expect(contributorKeys.list).toEqual(['contributors', REPOSITORY_SLUG])
  })
})

describe('解析', () => {
  it('把 GitHub 的下划线字段翻成界面用的驼峰字段', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { login: 'alice', avatar_url: 'https://a', html_url: 'https://github.com/alice', contributions: 42 },
      ]),
    )

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.contributors).toEqual([
      { login: 'alice', avatarUrl: 'https://a', profileUrl: 'https://github.com/alice', contributions: 42 },
    ])
  })

  it('缺 html_url 时用登录名拼一个主页，不产生死链', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ login: 'bob', avatar_url: 'https://b' }]))

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.contributors[0].profileUrl).toBe('https://github.com/bob')
    expect(result.current.contributors[0].contributions).toBe(0)
  })

  it('条目形状不对就整条丢掉，而不是渲染一张坏头像', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        null,
        'not-an-object',
        { avatar_url: 'https://a' },
        { login: 'carol' },
        { login: 7, avatar_url: 'https://c' },
        { login: 'dave', avatar_url: 'https://d' },
      ]),
    )

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.contributors.map(item => item.login)).toEqual(['dave'])
  })

  it('返回体不是数组时当成「没有贡献者」，而不是抛错', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }))

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.contributors).toEqual([])
  })
})

describe('失败退化', () => {
  it('HTTP 失败时给空数组：头像墙不该把设置页变成错误页', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'rate limited' }, 403))

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.contributors).toEqual([])
  })

  it('失败不重试——限流时越试越糟', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403))

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('加载态与缓存', () => {
  it('第一帧是加载中（与「真的没有贡献者」措辞不同）', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useContributors(), { wrapper })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.contributors).toEqual([])
  })

  it('一小时内再挂载不再问一次——公开接口每小时只有 60 次配额', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ login: 'alice', avatar_url: 'https://a' }]))
    const { wrapper } = createQueryFixture()

    const first = renderHook(() => useContributors(), { wrapper })
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))

    const second = renderHook(() => useContributors(), { wrapper })
    await waitFor(() => expect(second.result.current.contributors).toHaveLength(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
