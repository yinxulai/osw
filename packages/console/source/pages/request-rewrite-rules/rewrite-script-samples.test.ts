/**
 * 脚本示例的门禁。
 *
 * 这些代码字符串会**原样**进代码编辑器，也因此是 `i18n/no-hardcoded-cjk` 管不到的角落
 * （它们不是界面文案，而是一整段 JS）。代价是自己得盯着两条：
 * 一是不允许出现中文注释（这些代码要能被所有用户当成模板抄），二是示例必须体现
 * 「交回即整体替换」这条最容易被误解的语义——不然示例本身就是一份错误的文档。
 */

import { describe, expect, it } from 'vitest'
import { REWRITE_SCRIPT_SAMPLES, defaultRewriteScript } from './rewrite-script-samples'

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
})
