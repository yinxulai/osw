import { describe, expect, it } from 'vitest'
import { executeRewriteScript, type RewriteScriptInvocation } from './rewrite-script-sandbox'

/**
 * 修改器脚本沙箱的边界回归。
 *
 * 引擎测试覆盖的是「脚本结果怎么合并回报文」，这里盯的是沙箱本身：隔离边界、交回协议、
 * 日志与超时。沙箱只依赖 `node:vm` 与路径取值，可以脱离代理执行栈单独跑。
 */

type InvocationOverrides = Partial<Omit<RewriteScriptInvocation, 'ruleId'>>

function run(code: string, overrides: InvocationOverrides = {}) {
  return executeRewriteScript({
    ruleId: 'rule-probe',
    code,
    timeoutMilliseconds: 200,
    body: { marker: 'apply-strict', nested: { value: 1 } },
    headers: { 'X-Test': 'yes' },
    context: { stage: 'request', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions' },
    ...overrides,
  })
}

describe('executeRewriteScript', () => {
  it('交回对象时按 { body, headers } 取值', () => {
    const result = run('return { body: { ...body, temperature: 0 }, headers: { ...headers, "x-script": "yes" } }')
    expect(result.success).toBe(true)
    expect(result.body).toEqual({ marker: 'apply-strict', nested: { value: 1 }, temperature: 0 })
    expect(result.headers).toEqual({ 'X-Test': 'yes', 'x-script': 'yes' })
  })

  it('不返回、返回 undefined 或 null 时两项都不改动', () => {
    for (const code of ['const a = 1', 'return undefined', 'return null']) {
      const result = run(code)
      expect(result, code).toMatchObject({ success: true, body: undefined, headers: undefined })
    }
  })

  it('只交回其中一个键时另一个保持 undefined', () => {
    const bodyOnly = run('return { body: { a: 1 } }')
    expect(bodyOnly.body).toEqual({ a: 1 })
    expect(bodyOnly.headers).toBeUndefined()

    const headersOnly = run('return { headers: { "x-only": "1" } }')
    expect(headersOnly.body).toBeUndefined()
    expect(headersOnly.headers).toEqual({ 'x-only': '1' })
  })

  it('交回非对象时失败', () => {
    for (const code of ['return 42', 'return "text"', 'return [1, 2]', 'return true']) {
      expect(run(code).success, code).toBe(false)
    }
  })

  it('headers 里的 null / 数组 / 数字会被归一成字符串', () => {
    const result = run('return { headers: { "x-null": null, "x-array": ["a", "b"], "x-number": 3 } }')
    expect(result.success).toBe(true)
    expect(result.headers).toEqual({ 'x-null': '', 'x-array': ['a', 'b'], 'x-number': '3' })
  })

  it('headers 交回的不是扁平对象时失败', () => {
    expect(run('return { headers: [1, 2] }').success).toBe(false)
    expect(run('return { headers: "text" }').success).toBe(false)
  })

  it('交回的 body 会被序列化，循环引用不算交出内容', () => {
    const result = run('const loop = {}; loop.self = loop; return { body: loop }')
    expect(result.success).toBe(true)
    expect(result.body).toBeUndefined()
  })

  it('暴露 body / headers / protocol / get 与受控 console', () => {
    const result = run([
      'console.log("stage", protocol.stage)',
      'console.warn(get("nested.value"))',
      'console.error(headers["X-Test"])',
    ].join('\n'))
    expect(result.success).toBe(true)
    expect(result.logs).toEqual(['[log] stage request', '[warn] 1', '[error] yes'])
  })

  it('沙箱里没有 require / process / 定时器 / 网络', () => {
    // 交回值只认对象，所以这里用日志读回 `typeof`：拿到的都是 `"undefined"`。
    const result = run('console.log(typeof require, typeof process, typeof setTimeout, typeof fetch)')
    expect(result.success).toBe(true)
    expect(result.logs).toEqual(['[log] undefined undefined undefined undefined'])
  })

  it('造不出新代码：eval / new Function 被关掉', () => {
    // 禁的是「用字符串造出可执行代码」，不是 `eval` 这个名字本身。
    expect(run("return { body: eval('1 + 1') }").success).toBe(false)
    expect(run("return { body: new Function('return 1')() }").success).toBe(false)
  })

  it('死循环被超时中断，错误信息带超时上限', () => {
    const result = run('while (true) {}', { timeoutMilliseconds: 50 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(result.durationMilliseconds).toBeGreaterThanOrEqual(0)
  })

  it('脚本抛错时如实回传错误信息，不把异常带出沙箱', () => {
    const result = run('throw new Error("boom")')
    expect(result.success).toBe(false)
    expect(result.error).toContain('boom')
  })

  it('日志行数设上限，刷屏不把结果撑爆', () => {
    const result = run('for (let i = 0; i < 200; i += 1) console.log(i)')
    expect(result.logs).toHaveLength(50)
    expect(result.logs[0]).toBe('[log] 0')
  })

  it('对象与 undefined 的日志参数会被格式化', () => {
    const result = run('console.log({ a: 1 }, undefined, "raw")')
    expect(result.logs).toEqual(['[log] {"a":1} undefined raw'])
  })
})
