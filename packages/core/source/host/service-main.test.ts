import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 核心服务的运行时入口。
 *
 * 它整块就是一段顶层的接线：把 `process.parentPort` 包成 `RpcPort` 交给真正的运行时。
 * 这段接线只在一个地方生效过——被 `utilityProcess.fork()` 拉起来的那个进程——所以
 * 它在开发机上永远「看起来能跑」，出错也只在打包后才能发现：端口形状对不上时，
 * 表现为服务起来了但一条 RPC 都不通。
 *
 * 真起一个 utilityProcess 不在单元测试的射程里（进程的失败模式归 `service-host.test.ts`），
 * 这里替身掉运行时，只盯接线本身：消息怎么转发、`parentPort` 缺席时怎么拒绝。
 */

const started: unknown[] = []

interface StartServiceOptions { port: unknown }

vi.mock('./service-runtime', () => ({
  startServiceRuntime: async (options: StartServiceOptions) => {
    started.push(options.port)
  },
}))

/** Electron 的 `ParentPort`：消息带一层 `{ data, ports }` 外皮，`data` 才是载荷。 */
class FakeParentPort extends EventEmitter {
  posted: unknown[] = []

  postMessage(message: unknown): void {
    this.posted.push(message)
  }
}

interface RpcPortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (data: unknown) => void): void
}

function installParentPort(): FakeParentPort {
  const parentPort = new FakeParentPort()
  Object.defineProperty(process, 'parentPort', { value: parentPort, configurable: true, writable: true })
  return parentPort
}

function removeParentPort(): void {
  Reflect.deleteProperty(process, 'parentPort')
}

/** 模块顶层带 `await`，且只在导入时跑一次接线，所以每条用例都得重新求值一次。 */
async function importServiceMain(): Promise<void> {
  vi.resetModules()
  await import('./service-main')
}

afterEach(() => {
  removeParentPort()
  started.length = 0
})

describe('service-main', () => {
  it('refuses to run outside an Electron utility process', async () => {
    // 普通 Node 进程里 `parentPort` 是 undefined。继续往下走会得到一个永远收不到消息、
    // 也发不出去的服务：宿主那边只看到「进程活着但没反应」，比直接崩掉难查得多。
    await expect(importServiceMain()).rejects.toThrow('must be started as an Electron utility process')
  })

  it('forwards posted messages straight to the parent port', async () => {
    const parentPort = installParentPort()

    await importServiceMain()

    const port = started[0] as RpcPortLike
    port.postMessage({ type: 'service.ready' })
    expect(parentPort.posted).toEqual([{ type: 'service.ready' }])
  })

  it('unwraps the data envelope on incoming messages', async () => {
    const parentPort = installParentPort()

    await importServiceMain()

    const received: unknown[] = []
    ;(started[0] as RpcPortLike).on('message', data => received.push(data))
    // 宿主用 `postMessage(payload)` 发出来的是 `{ data: payload, ports: [] }`。
    // 把这层外皮原样交给上层，所有 RPC 的参数都会变成 undefined。
    parentPort.emit('message', { data: { id: 'req_1', method: 'runtime.config' }, ports: [] })

    expect(received).toEqual([{ id: 'req_1', method: 'runtime.config' }])
  })
})
