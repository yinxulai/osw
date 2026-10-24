// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProxyToggle } from './use-proxy-toggle'

/*
 * 逻辑模型页右上角的「服务开关」。
 *
 * 两件事值得钉住：
 *  - 按钮是**同一个**：状态决定它调 start 还是 stop。写反了就是「点停止反而启动」；
 *  - 提示必须跟着**服务端返回的** running 走，而不是跟着点击前的状态走 —— 启动失败/状态竞态时，
 *    界面上的文案不能撒谎。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  status: null as Record<string, unknown> | null,
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/data/proxy', () => ({
  useProxyStatus: () => state.status,
  useProxyActions: () => ({ start: state.start, stop: state.stop }),
}))

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.start.mockReset()
  state.stop.mockReset()
  state.status = { running: false, host: '127.0.0.1', port: 19300 }
})

function setup() {
  return renderHook(() => useProxyToggle())
}

describe('开关动作', () => {
  it('服务在跑时点击是「停止」', async () => {
    state.status = { running: true, host: '127.0.0.1', port: 19300 }
    state.stop.mockResolvedValue({ success: true, data: { running: false } })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.stop).toHaveBeenCalledTimes(1)
    expect(state.start).not.toHaveBeenCalled()
    expect(state.success).toHaveBeenCalledWith('服务已停止')
  })

  it('服务没跑时点击是「启动」', async () => {
    state.start.mockResolvedValue({ success: true, data: { running: true } })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.start).toHaveBeenCalledTimes(1)
    expect(state.stop).not.toHaveBeenCalled()
    expect(state.success).toHaveBeenCalledWith('服务已启动')
  })

  it('状态还没拿到时按「启动」处理，不会调用不存在的 stop', async () => {
    state.status = null
    state.start.mockResolvedValue({ success: true, data: { running: true } })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.start).toHaveBeenCalledTimes(1)
    expect(state.stop).not.toHaveBeenCalled()
  })

  it('提示跟服务端返回的 running 走，而不是点击前的状态', async () => {
    // 明明是在「停止」，但服务端返回说它还在跑（例如被别处又拉起来了）——文案必须照实说。
    state.status = { running: true, host: '127.0.0.1', port: 19300 }
    state.stop.mockResolvedValue({ success: true, data: { running: true } })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.success).toHaveBeenCalledWith('服务已启动')
  })
})

describe('失败', () => {
  it('失败时把服务端的原因直接给用户，且不报成功', async () => {
    state.start.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: '端口 19300 已被占用' })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.error).toHaveBeenCalledWith('端口 19300 已被占用')
    expect(state.success).not.toHaveBeenCalled()
  })

  it('停止失败时同样只报错', async () => {
    state.status = { running: true, host: '127.0.0.1', port: 19300 }
    state.stop.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: '服务无响应' })
    const { result } = setup()

    await act(async () => {
      await result.current.toggleProxy()
    })

    expect(state.error).toHaveBeenCalledWith('服务无响应')
    expect(state.success).not.toHaveBeenCalled()
  })
})

describe('展示用的地址', () => {
  it('监听 0.0.0.0 时给客户端能连的回环地址', () => {
    state.status = { running: true, host: '0.0.0.0', port: 19300 }

    const { result } = setup()

    expect(result.current.proxyBaseUrl).toBe('http://127.0.0.1:19300')
  })

  it('IPv6 回环要补方括号，否则会被当成主机名', () => {
    state.status = { running: true, host: '::1', port: 19300 }

    const { result } = setup()

    expect(result.current.proxyBaseUrl).toBe('http://[::1]:19300')
  })

  it('没有端口就不拼半个地址（界面据此禁用复制按钮）', () => {
    state.status = { running: false, host: '127.0.0.1', port: null }

    const { result } = setup()

    expect(result.current.proxyBaseUrl).toBe('')
  })

  it('状态还没拿到时也是空串', () => {
    state.status = null

    const { result } = setup()

    expect(result.current.proxyBaseUrl).toBe('')
  })
})
