// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ErrorBoundary, ErrorFallback, describeError } from './error-boundary'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

interface BombProps { message: string; armed?: boolean }

/** 渲染期抛错的子树：错误边界只兜得住这一类。 */
function Bomb(props: BombProps) {
  if (props.armed !== false) throw new Error(props.message)
  return <p>alive</p>
}

describe('describeError', () => {
  const fallbacks = { unknownTitle: '未知错误', nonErrorTitle: '非 Error 对象' }

  it('Error 用 message 当标题，调用栈进详情', () => {
    const error = new Error('供应商不存在：prov_x')
    const described = describeError(error, fallbacks)

    expect(described.title).toBe('供应商不存在：prov_x')
    expect(described.detail).toContain('Error: 供应商不存在：prov_x')
  })

  // `new Error('')` 的 message 是空串，标题会变成一个空白的强调行。
  it('Error 没有 message 时退回构造函数名', () => {
    expect(describeError(new Error(''), fallbacks).title).toBe('Error')
    expect(describeError(new TypeError(''), fallbacks).title).toBe('TypeError')
  })

  it('字符串原样当标题', () => {
    expect(describeError('后端直接抛了字符串', fallbacks)).toEqual({ title: '后端直接抛了字符串', detail: null })
  })

  // `throw undefined` / `throw null` 都要有话说，不能渲染出一个空标题。
  it('null / undefined 用兜底标题', () => {
    expect(describeError(null, fallbacks)).toEqual({ title: '未知错误', detail: null })
    expect(describeError(undefined, fallbacks)).toEqual({ title: '未知错误', detail: null })
  })

  it('普通对象序列化进详情，标题说明它不是 Error', () => {
    const described = describeError({ code: 'EADDRINUSE', port: 9300 }, fallbacks)

    expect(described.title).toBe('非 Error 对象')
    expect(JSON.parse(described.detail!)).toEqual({ code: 'EADDRINUSE', port: 9300 })
  })

  // 环形引用会让 `JSON.stringify` 抛错——那时不能连标题都丢掉。
  it('无法序列化时退回 String()', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    const described = describeError(circular, fallbacks)

    expect(described.title).toBe('[object Object]')
    expect(described.detail).toBeNull()
  })
})

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let swallowWindowError: (event: ErrorEvent) => void

  beforeEach(() => {
    useLanguageStore.setState({ preference: 'zh-CN' })
    // React 打给控制台的「consider adding an error boundary」噪音，和这里要验的东西无关。
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // jsdom 会把被错误边界接住的异常再报到虚拟控制台（事件未被 cancel 就上报）。
    // 这里主动 cancel，测试输出里才不会刷几十行本该被接住的调用栈。
    swallowWindowError = event => event.preventDefault()
    window.addEventListener('error', swallowWindowError)
  })

  afterEach(() => {
    window.removeEventListener('error', swallowWindowError)
    consoleError.mockRestore()
  })

  it('子树正常时原样渲染，不额外包一层壳', () => {
    render(<ErrorBoundary><p>内容</p></ErrorBoundary>, { wrapper: Wrapper })

    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('渲染期抛错时换成兜底界面，页面不再整块变白', () => {
    render(<ErrorBoundary><Bomb message="供应商不存在：prov_x" /></ErrorBoundary>, { wrapper: Wrapper })

    expect(screen.getByText('界面出错了')).toBeTruthy()
    expect(screen.getByText('供应商不存在：prov_x')).toBeTruthy()
  })

  // 组件栈比 JS 栈更能指出是谁崩的，这条信息必须进日志。
  it('把错误与组件栈打到控制台，并回调 onError', () => {
    const onError = vi.fn()
    render(<ErrorBoundary onError={onError}><Bomb message="boom" /></ErrorBoundary>, { wrapper: Wrapper })

    expect(consoleError).toHaveBeenCalledWith('[ErrorBoundary]', expect.any(Error), expect.any(String))
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ componentStack: expect.any(String) }))
  })

  it('传了 fallback 就完全接管兜底界面', () => {
    render(
      <ErrorBoundary fallback={props => <button onClick={props.reset}>自定义兜底</button>}>
        <Bomb message="boom" />
      </ErrorBoundary>,
      { wrapper: Wrapper },
    )

    expect(screen.getByRole('button', { name: '自定义兜底' })).toBeTruthy()
    expect(screen.queryByText('界面出错了')).toBeNull()
  })

  it('点「重试」清掉错误状态，子树回到渲染', () => {
    const { rerender } = render(<ErrorBoundary><Bomb message="boom" /></ErrorBoundary>, { wrapper: Wrapper })

    rerender(<ErrorBoundary><Bomb message="boom" armed={false} /></ErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))

    expect(screen.getByText('alive')).toBeTruthy()
  })

  // 路由级兜底靠这条：某个页面崩了，用户切到别的页面就自动恢复，不用重启整个应用。
  it('resetKeys 变化时自动清掉错误，不用用户手点', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['/router']}><Bomb message="boom" /></ErrorBoundary>,
      { wrapper: Wrapper },
    )
    expect(screen.getByText('界面出错了')).toBeTruthy()

    rerender(<ErrorBoundary resetKeys={['/overview']}><Bomb message="boom" armed={false} /></ErrorBoundary>)

    expect(screen.getByText('alive')).toBeTruthy()
  })

  it('resetKeys 内容不变时不重置', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['/router']}><Bomb message="boom" /></ErrorBoundary>,
      { wrapper: Wrapper },
    )

    rerender(<ErrorBoundary resetKeys={['/router']}><Bomb message="boom" /></ErrorBoundary>)

    expect(screen.getByText('界面出错了')).toBeTruthy()
  })
})

describe('ErrorFallback', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'zh-CN' })
  })

  it('整页兜底带「重新加载应用」，路由级不带', () => {
    const { unmount } = render(<ErrorFallback error={new Error('boom')} reset={() => {}} />, { wrapper: Wrapper })
    expect(screen.getByRole('button', { name: '重新加载应用' })).toBeTruthy()
    unmount()

    render(<ErrorFallback error={new Error('boom')} reset={() => {}} embedded />, { wrapper: Wrapper })
    expect(screen.queryByRole('button', { name: '重新加载应用' })).toBeNull()
    // 路由级仍然要能原地重试。
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy()
  })

  it('标题与说明可以被调用方覆盖', () => {
    render(
      <ErrorFallback error={new Error('boom')} reset={() => {}} title="页面出错了" description="当前页面的组件抛出了异常" />,
      { wrapper: Wrapper },
    )

    expect(screen.getByText('页面出错了')).toBeTruthy()
    expect(screen.getByText('当前页面的组件抛出了异常')).toBeTruthy()
  })

  it('没有调用栈时不渲染「调用栈」折叠区', () => {
    render(<ErrorFallback error="后端直接抛了字符串" reset={() => {}} />, { wrapper: Wrapper })

    expect(screen.getByText('后端直接抛了字符串')).toBeTruthy()
    expect(screen.queryByText('调用栈')).toBeNull()
  })
})
