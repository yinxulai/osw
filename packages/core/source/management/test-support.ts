import type { ServerResponse } from 'node:http'
import { vi } from 'vitest'

/**
 * 构造管理路由单测使用的 `ServerResponse` 替身。
 *
 * 之前 13 个测试文件各自复制了一份实现，字段组合略有出入，导致
 * 某些路由在读取 `headersSent` / `writableEnded` 时拿到的是 `undefined`。
 * 这里统一提供可写状态字段的超集，并用 overrides 覆盖个别场景。
 *
 * `write` 恒返回 `true`（「内核缓冲区没满」）：替身没有真的内核缓冲区，而 `undefined` 是
 * 假值——任何读这个返回值的写入方（流式路由）都会在单测里把每一帧都判成「写不下」。
 * 要验背压的用例自己传 `overrides`。
 *
 * `once` / `removeListener` 也要有：流式路由靠 `res.once('close')` 发现「客户端走了」
 * （`req` 的 `aborted` 在真实连接上不发，见该路由的注释），缺了它们处理器会当场抛错。
 */
export function mockResponse(overrides: Partial<ServerResponse> = {}): ServerResponse {
  return {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    destroy: vi.fn(),
    setHeader: vi.fn(),
    write: vi.fn(() => true),
    once: vi.fn(),
    removeListener: vi.fn(),
    end: vi.fn(),
    ...overrides,
  } as unknown as ServerResponse
}
