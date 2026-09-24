import { describe, expect, it } from 'vitest'
import { PROXY_INTERFACE_ENTRIES, PROXY_INTERFACE_IDS } from '@common/protocols'
import { localEndpoints } from '@server/proxy/local/registry'
import { detectProtocolFromRequest, listProtocolRoutes } from './registry'

/**
 * 注册表受理、但不对外承诺的入口。
 *
 * 旧版文本补全（`/v1/completions`）与文本向量（`/v1/embeddings`）与对话补全同属
 * `openai-completions`，入口匹配规则因此是一起注册的：客户端真发过来时服务照常识别协议、
 * 忠实转发，不会撞 404。但一次请求落到上游靠的是 ProviderModel 端点自己配的地址，而端点地址是按协议
 * 配的（一个协议一个地址，见 `planners/target-planner.ts`）——这两条路径没有对应的地址形态，
 * 转发出去只会把正文送到一个聊天接口的地址上。所以它们不在对外清单里。
 *
 * 列在这里不是为了记录现状，而是为了让「注册表多出一条路径」必须有人做一次决定：
 * 新增入口要么写进契约（对外承诺），要么在这里留名字（认得出但不承诺）。
 */
const UNEXPOSED_ROUTES = [
  'POST /v1/completions',
  'POST /completions',
  'POST /v1/embeddings',
  'POST /embeddings',
]

/**
 * 对外接口面的一致性。
 *
 * 引导页第三步那张「本服务接受的接口」表直接照契约渲染（`@common/protocols` 的
 * `PROXY_INTERFACE_ENTRIES`），这意味着这张表既不是文档也不是快照，而是一份必须成立的声明。
 * 两个方向上的偏差都得当场失败：清单里写了而服务不认——用户照抄却撞 404；
 * 服务认而清单里没写——接口变成没人知道的隐藏能力。下面两条断言各守一个方向。
 *
 * 但「服务认」比「对外承诺」宽：注册表里有几条路径只是入口识别，接上去不成立（见 `UNEXPOSED_ROUTES`）。
 * 它们的名字留在这里，是为了让「注册表多出一条路径」这件事必须有人做一次决定。
 */
describe('对外接口面与注册表一致', () => {
  const declared = PROXY_INTERFACE_ENTRIES.flatMap(entry =>
    entry.paths.map(path => ({ entry, method: entry.method, path })))

  it('接口清单覆盖每一个接口 id，且不重复', () => {
    expect([...PROXY_INTERFACE_ENTRIES.map(entry => entry.id)].sort()).toEqual([...PROXY_INTERFACE_IDS].sort())
  })

  it('契约声明的每条路径都被服务端受理，并落到声明的协议上', () => {
    for (const { entry, method, path } of declared) {
      if (entry.protocol === null) {
        expect(
          localEndpoints.some(endpoint => endpoint.method === method && endpoint.path === path),
          `${method} ${path} 应当是已声明的本地端点`,
        ).toBe(true)
        continue
      }
      expect(detectProtocolFromRequest(method, path), `${method} ${path}`).toBe(entry.protocol)
    }
  })

  it('服务端声明的每条路径要么写进契约，要么在「认得出但不承诺」名单里', () => {
    const written = new Set(declared.map(({ method, path }) => `${method} ${path}`))
    const unexposed = new Set(UNEXPOSED_ROUTES)
    for (const route of listProtocolRoutes()) {
      const key = `${route.method} ${route.path}`
      expect(
        written.has(key) || unexposed.has(key),
        `${key} 既不在契约的接口清单里，也不在 UNEXPOSED_ROUTES 里`,
      ).toBe(true)
    }
    for (const endpoint of localEndpoints) {
      const key = `${endpoint.method} ${endpoint.path}`
      expect(
        written.has(key) || unexposed.has(key),
        `${key} 既不在契约的接口清单里，也不在 UNEXPOSED_ROUTES 里`,
      ).toBe(true)
    }
  })

  it('「认得出但不承诺」名单里的路径都还在注册表里，也没被误写进契约', () => {
    const registered = new Set(listProtocolRoutes().map(route => `${route.method} ${route.path}`))
    const written = new Set(declared.map(({ method, path }) => `${method} ${path}`))
    for (const route of UNEXPOSED_ROUTES) {
      expect(registered.has(route), `${route} 已经不在注册表里，这一条该删`).toBe(true)
      expect(written.has(route), `${route} 已经写进契约，就不该再留在 UNEXPOSED_ROUTES 里`).toBe(false)
    }
  })
})
