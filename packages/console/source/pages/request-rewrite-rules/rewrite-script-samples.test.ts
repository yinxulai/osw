/**
 * 脚本示例的门禁。
 *
 * 这些代码字符串会**原样**进代码编辑器，也因此是 `i18n/no-hardcoded-cjk` 管不到的角落
 * （它们不是界面文案，而是一整段 JS）。代价是自己得盯着两条：
 * 一是不允许出现中文注释（这些代码要能被所有用户当成模板抄），二是示例必须体现
 * 「交回即整体替换」这条最容易被误解的语义——不然示例本身就是一份错误的文档。
 */

import { describe, expect, it } from 'vitest'
import { REWRITE_SCRIPT_SAMPLES, defaultRewriteScript, rewriteScriptSamplesForStage, shouldReseedScript } from './rewrite-script-samples'

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/

describe('脚本示例', () => {
  it('id 唯一且都自带代码', () => {
    const ids = REWRITE_SCRIPT_SAMPLES.map(sample => sample.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const sample of REWRITE_SCRIPT_SAMPLES) {
      expect(sample.code.trim().length, `${sample.id} 缺少代码`).toBeGreaterThan(0)
    }
  })

  it('代码里不出现中文：这些字符串会直接进代码编辑器', () => {
    for (const sample of REWRITE_SCRIPT_SAMPLES) {
      expect(CJK.test(sample.code), `${sample.id} 的代码里混入了中文`).toBe(false)
    }
  })

  it('每个示例都能作为函数体解析，且交回 body 时基于原有内容而非另起炉灶', () => {
    for (const sample of REWRITE_SCRIPT_SAMPLES) {
      // 示例必须真的能被沙箱当函数体执行：语法错一个字符，用户拿到的就是个不能跑的起点。
      expect(() => new Function(sample.code), `${sample.id} 不是合法的函数体`).not.toThrow()
      // 交回 body 的示例必须从原 body 起手（`{ ...body }` 或从 body 解构出 rest）：
      // 整体替换语义下，凭空造一个对象等于把其余字段全删了。
      if (/\bbody:/.test(sample.code)) {
        expect(sample.code, `${sample.id} 交回 body 时没有沿用原内容`).toMatch(/\.\.\.body|= body|\bbody\b\s*\|\|/)
      }
    }
  })

  it('切到脚本时的起始脚本按阶段区分，且与对应基线一致', () => {
    expect(defaultRewriteScript('request')).toBe(REWRITE_SCRIPT_SAMPLES.find(sample => sample.id === 'request-baseline')?.code)
    expect(defaultRewriteScript('response')).toBe(REWRITE_SCRIPT_SAMPLES.find(sample => sample.id === 'response-baseline')?.code)
  })

  it('示例按阶段成对：两个阶段都有条目，且下拉只列当前阶段', () => {
    const request = rewriteScriptSamplesForStage('request')
    const response = rewriteScriptSamplesForStage('response')
    // 两个阶段都非空：只给请求示例，就是「响应脚本没得选」的那半个空缺。
    expect(request.length).toBeGreaterThan(0)
    expect(response.length).toBeGreaterThan(0)
    // 过滤不能泄漏另一个阶段的条目，否则请求脚本会插入一段只在响应阶段才跑的代码。
    expect(request.every(sample => sample.stage === 'request')).toBe(true)
    expect(response.every(sample => sample.stage === 'response')).toBe(true)
    expect(request.length + response.length).toBe(REWRITE_SCRIPT_SAMPLES.length)
  })

  it('切阶段只在「还没动过基线」时重填起始脚本', () => {
    // 编辑器里还是请求阶段的默认基线：切到响应阶段应当换成响应基线，否则起点跑不通。
    expect(shouldReseedScript(defaultRewriteScript('request'), 'request', 'response')).toBe(true)
    // 用户改过几笔：那是他的劳动，切阶段不能冲掉。
    expect(shouldReseedScript('return { body: { ...body, temperature: 1 } }', 'request', 'response')).toBe(false)
    // 同一个阶段之间切换本就不该动它。
    expect(shouldReseedScript(defaultRewriteScript('response'), 'response', 'response')).toBe(false)
    // 没选目标时 code 为空，同样不重填。
    expect(shouldReseedScript(undefined, 'request', 'response')).toBe(false)
  })
})
