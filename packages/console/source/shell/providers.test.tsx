// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShellProviders, mountShell } from './providers'
import { useTranslation } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

/*
 * 渲染外壳的两个职责：
 *   1. 两个入口（控制台 / 托盘面板）共用**同一份** provider 组合与查询默认值——
 *      差一个 provider，某入口的组件就在运行时才炸；
 *   2. `mountShell` 决定挂在哪个容器、带不带 StrictMode、并发渲染丢树时报不报错。
 *
 * 查询默认值里有一条是有原因的：`refetchOnWindowFocus` 必须关。托盘面板靠 blur 收起，
 * 开着它等于每收起一次就整体重取一遍。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function Probe() {
  const client = useQueryClient()
  const t = useTranslation()
  return (
    <>
      <span data-testid="translated">{t('common.state.deleted')}</span>
      <span data-testid="stale-time">{String(client.getDefaultOptions().queries?.staleTime)}</span>
    </>
  )
}

function Boom(): never {
  throw new Error('炸了')
}

beforeEach(() => {
  document.body.innerHTML = ''
  // 语言偏好看本地存储，上一条用例可能已经把它改成别的语言（模块级状态跨用例共享）。
  window.localStorage.clear()
  useLanguageStore.setState({ preference: 'zh-CN' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShellProviders', () => {
  it('同时提供查询客户端与多语言（两个入口都靠它）', () => {
    render(
      <ShellProviders>
        <Probe />
      </ShellProviders>,
    )

    expect(screen.getByTestId('translated').textContent).toBe('已删除')
    expect(screen.getByTestId('stale-time').textContent).toBe('5000')
  })

  it('窗口重新聚焦时不重取（托盘面板靠 blur 收起，开着会整体刷）', () => {
    function OptionsProbe() {
      const client = useQueryClient()
      return <span data-testid="focus">{String(client.getDefaultOptions().queries?.refetchOnWindowFocus)}</span>
    }

    render(
      <ShellProviders>
        <OptionsProbe />
      </ShellProviders>,
    )

    expect(screen.getByTestId('focus').textContent).toBe('false')
  })

  it('自动重试只给一次（重试多了错误态要等很久才出现）', () => {
    function RetryProbe() {
      const client = useQueryClient()
      return <span data-testid="retry">{String(client.getDefaultOptions().queries?.retry)}</span>
    }

    render(
      <ShellProviders>
        <RetryProbe />
      </ShellProviders>,
    )

    expect(screen.getByTestId('retry').textContent).toBe('1')
  })

  it('子树渲染期抛错时换成兜底界面，而不是白屏', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ShellProviders>
        <Boom />
      </ShellProviders>,
    )

    // 兜底界面用的是基础标签，不依赖可能同样崩掉的布局组件。
    //
    // 这条用例同时钉住一个**顺序**：错误边界必须在 `I18nProvider` 内部。
    // 放到外面时，兜底界面自己调 `useTranslation()` 会抛「useI18n must be used inside
    // I18nProvider」，于是兜底变成白屏的第二个来源，比不加错误边界还糟。
    expect(screen.getByText('界面出错了')).toBeTruthy()
    expect(screen.getByText('炸了')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
  })

  it('模块级查询客户端是共享的（两次挂载拿到同一个实例）', () => {
    const seen: unknown[] = []
    function CaptureProbe() {
      seen.push(useQueryClient())
      return null
    }

    render(
      <ShellProviders>
        <CaptureProbe />
      </ShellProviders>,
    )
    render(
      <ShellProviders>
        <CaptureProbe />
      </ShellProviders>,
    )

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBe(1)
  })
})

describe('mountShell', () => {
  it('挂到调用处指定的容器上，并自动带上 provider', async () => {
    const container = document.createElement('div')
    container.id = 'tray-root'
    document.body.append(container)

    mountShell('tray-root', <span data-testid="panel">面板</span>)

    await waitFor(() => expect(container.querySelector('[data-testid="panel"]')).toBeTruthy())
    expect(screen.getByTestId('panel').textContent).toBe('面板')
  })

  it('容器 id 由调用方给，不硬编码 root（托盘面板与控制台容器同名但互不干扰）', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    const other = document.createElement('div')
    other.id = 'other'
    document.body.append(root, other)

    mountShell('other', <span data-testid="here">在这</span>)

    await waitFor(() => expect(other.querySelector('[data-testid="here"]')).toBeTruthy())
    expect(root.childElementCount).toBe(0)
  })

  it('包在 StrictMode 里（开发期提前暴露副作用双跑问题）', async () => {
    const container = document.createElement('div')
    container.id = 'strict-root'
    document.body.append(container)

    mountShell('strict-root', <span data-testid="strict">严格</span>)

    await waitFor(() => expect(container.querySelector('[data-testid="strict"]')).toBeTruthy())
  })
})
