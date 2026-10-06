// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOutboundProxyTest } from './use-outbound-proxy-test'

/*
 * 出口代理探测按钮。
 *
 * 这段逻辑里有两条容易写错、且用户能直接看出来的分支：
 *  - 超时由客户端计时器负责（黑洞地址会把服务端自己的超时拖得很久），
 *    而超时同样是「abort」，所以要**先判超时**，否则用户看到的是我们自己的假错误；
 *  - 连点两下时前一次的结果必须丢掉，不然先回来的旧结果会盖住新的。
 */

const state = vi.hoisted(() => ({
  test: vi.fn(),
}))

vi.mock('@/api/runtime', () => ({
  outboundProxyApi: { test: (input: unknown, signal?: AbortSignal) => state.test(input, signal) },
}))

vi.mock('@/i18n/provider', async () => {
  // 注意：`localizeErrorCode()` 走的是 `@/i18n/active` 里的模块级取词函数（React 树之外用），
  // 真实应用靠 `I18nProvider` 调用 `getTranslator(locale)` 把它同步成当前语言。
  // 这里 mock 掉了 provider，就必须自己补上这一步，否则 hook 自己的文案是中文、
  // 而错误码本地化会退回英文目录 —— 与线上行为不一致。
  const { getTranslator } = await import('@/i18n/active')
  const t = getTranslator('zh-CN')
  return { useTranslation: () => t }
})

const input = {
  mode: 'custom' as never,
  proxyUrl: 'http://127.0.0.1:7890',
  bypass: '',
  targetUrl: 'https://example.com',
}

const result = { targetUrl: 'https://example.com', statusCode: 200, durationMilliseconds: 120 }

beforeEach(() => {
  vi.useFakeTimers()
  state.test.mockReset()
  state.test.mockResolvedValue({ success: true, data: result })
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  return renderHook(() => useOutboundProxyTest())
}

/** 造一个「只有被 abort 才会结束」的桩，形状与 `request()` 的 catch 分支一致。 */
function abortable() {
  state.test.mockImplementation(
    (_input: unknown, signal?: AbortSignal) =>
      new Promise(resolve => {
        signal?.addEventListener('abort', () =>
          resolve({ success: false, errorCode: 'NETWORK_ERROR', errorMessage: 'The operation was aborted' }),
        )
      }),
  )
}

describe('空闲与进行中', () => {
  it('开始前是空闲态', () => {
    const { result: view } = setup()

    expect(view.current.status).toBe('idle')
    expect(view.current.result).toBeUndefined()
    expect(view.current.errorMessage).toBeUndefined()
  })

  it('点击后立刻进入进行中，界面上能转圈', async () => {
    state.test.mockImplementation(() => new Promise(() => undefined))
    const { result: view } = setup()

    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })

    expect(view.current.status).toBe('running')
  })
})

describe('成功', () => {
  it('成功时给出探测结果，供界面显示状态码与耗时', async () => {
    const { result: view } = setup()

    await act(async () => {
      await view.current.run(input)
    })

    expect(state.test).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    expect(view.current.status).toBe('success')
    expect(view.current.result).toEqual(result)
  })

  it('成功后不再留着上一次的错误', async () => {
    state.test.mockResolvedValueOnce({ success: false, errorCode: 'X', errorMessage: 'boom' })
    const { result: view } = setup()
    await act(async () => {
      await view.current.run(input)
    })
    expect(view.current.errorMessage).toBeTruthy()

    await act(async () => {
      await view.current.run(input)
    })

    expect(view.current.errorMessage).toBeUndefined()
  })
})

describe('服务端返回失败', () => {
  it('按 errorCode 本地化，而不是把英文诊断直接摆出来', async () => {
    state.test.mockResolvedValue({
      success: false,
      errorCode: 'OUTBOUND_PROXY_UNREACHABLE',
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:7890',
    })
    const { result: view } = setup()

    await act(async () => {
      await view.current.run(input)
    })

    expect(view.current.status).toBe('error')
    expect(view.current.errorMessage).toBe('无法通过出站代理连接到目标地址')
  })

  it('没有对应文案的错误码退回服务端的诊断原文', async () => {
    state.test.mockResolvedValue({
      success: false,
      errorCode: 'SOME_FUTURE_CODE',
      errorMessage: 'upstream returned 502',
    })
    const { result: view } = setup()

    await act(async () => {
      await view.current.run(input)
    })

    expect(view.current.errorMessage).toBe('upstream returned 502')
  })

  it('模板里带 errorParams 的错误码会把上下文补回去，不会留下裸花括号', async () => {
    state.test.mockResolvedValue({
      success: false,
      errorCode: 'ENDPOINT_URL_MISSING',
      errorMessage: 'provider has no endpoint for this protocol',
      errorParams: { providerName: 'Example', protocols: 'OpenAI' },
    })
    const { result: view } = setup()

    await act(async () => {
      await view.current.run(input)
    })

    expect(view.current.errorMessage).toBe(
      '供应商「Example」还没有配置 OpenAI 协议的上游地址：请先在供应商里填写该协议的地址，或者给模型填写自定义地址',
    )
  })
})

describe('超时', () => {
  it('30 秒还没回来就判超时，并且给出的不是「请求被取消」这种内部说法', async () => {
    // 真链路里被 abort 的 fetch 会 reject，`request()` 把它收成 NETWORK_ERROR；
    // 照这个形状造桩，才能验出「先判超时」这件事真的有意义。
    abortable()
    const { result: view } = setup()

    await act(async () => {
      const pending = view.current.run(input)
      await vi.advanceTimersByTimeAsync(30_000)
      await pending
    })

    expect(view.current.status).toBe('error')
    expect(view.current.errorMessage).toBe('测试超时未返回，代理或探测目标可能被挂住了')
  })

  it('还没到 30 秒就不该判超时', async () => {
    abortable()
    const { result: view } = setup()

    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(29_999)
    })

    expect(view.current.status).toBe('running')
  })

  it('正常返回时会清掉计时器，事后不会被「超时」再改一次状态', async () => {
    const { result: view } = setup()

    await act(async () => {
      await view.current.run(input)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(view.current.status).toBe('success')
  })
})

describe('连点两次', () => {
  it('后一次会取消前一次', async () => {
    const signals: AbortSignal[] = []
    state.test.mockImplementation((_input: unknown, signal?: AbortSignal) => {
      signals.push(signal as AbortSignal)
      return new Promise(() => undefined)
    })
    const { result: view } = setup()

    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })
    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })

    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('被取代的那一次即使后返回也不改界面（否则旧结果会盖住新结果）', async () => {
    let releaseFirst: (value: unknown) => void = () => undefined
    state.test.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = resolve }),
    )
    state.test.mockImplementationOnce(() => new Promise(() => undefined))
    const { result: view } = setup()

    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })
    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })
    expect(view.current.status).toBe('running')

    // 第一次的响应迟到了，回来时必须被丢掉。
    await act(async () => {
      releaseFirst({ success: true, data: result })
      await Promise.resolve()
    })

    expect(view.current.result).toBeUndefined()
    expect(view.current.status).toBe('running')
  })

  it('被取代的那一次即使以失败收场，也不该把新一次的进行中改成失败', async () => {
    let endFirst: () => void = () => undefined
    state.test.mockImplementationOnce(
      (_input: unknown, signal?: AbortSignal) =>
        new Promise(resolve => {
          endFirst = () => resolve({ success: false, errorCode: 'NETWORK_ERROR', errorMessage: 'The operation was aborted' })
          signal?.addEventListener('abort', () => endFirst())
        }),
    )
    state.test.mockImplementationOnce(() => new Promise(() => undefined))
    const { result: view } = setup()

    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })
    // 第二次点击会 abort 掉第一次，第一次的桩在这里就地收尾（真实实现也会立刻返回）。
    await act(async () => {
      void view.current.run(input)
      await Promise.resolve()
    })
    await act(async () => {
      endFirst()
      await Promise.resolve()
    })

    expect(view.current.status).toBe('running')
    expect(view.current.errorMessage).toBeUndefined()
  })
})
