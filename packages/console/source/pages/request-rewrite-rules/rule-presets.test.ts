/**
 * 内置规则模板的门禁。
 *
 * 这些模板是「新建规则」下拉里的全部内容，两个地方最容易在改动中被无声破坏：
 * 一是 UA 默认值里的版本号（`__APP_VERSION__` 没注入就会变成空串或未展开的占位符），
 * 二是「模板只填草稿」这个约定（多写一个 `global: true` 就会让新规则悄悄作用于所有模型）。
 */

import { describe, expect, it } from 'vitest'
import { getTranslator } from '@/i18n/active'
import { RULE_PRESETS, createBlankRule, createRuleFromPreset } from './rule-presets'

const t = getTranslator('zh-CN')

describe('内置规则模板', () => {
  it('修改 UA 的默认值是 OSW/<构建时的应用版本号>', () => {
    const preset = RULE_PRESETS.find(item => item.id === 'set-user-agent')
    if (!preset) throw new Error('缺少「修改 User-Agent」模板')

    const [action] = preset.actions
    expect(action).toMatchObject({ stage: 'request', target: 'header', operation: 'set', path: 'User-Agent' })
    expect(action.value).toBe(`OSW/${__APP_VERSION__}`)
    // 版本号必须真的被替换进来了：注入失败时 `__APP_VERSION__` 会变成 `undefined` 或空串。
    expect(action.value).toMatch(/^OSW\/\d+\.\d+/)
  })

  it('清单保持精简，每个模板只演示一种基础动作并自带可运行用例', () => {
    expect(RULE_PRESETS.map(preset => preset.id)).toEqual(['set-user-agent', 'remove-request-header', 'set-request-field'])
    for (const preset of RULE_PRESETS) {
      expect(preset.actions, `${preset.id} 应只有一个动作`).toHaveLength(1)
      expect(preset.testCase.headers.length, `${preset.id} 缺少试跑请求头`).toBeGreaterThan(0)
      expect(preset.testCase.body.length, `${preset.id} 缺少试跑请求体`).toBeGreaterThan(0)
    }
  })

  it('套用模板产出的是未保存的草稿，动作与用例都带 id', () => {
    for (const preset of RULE_PRESETS) {
      const rule = createRuleFromPreset(preset, t)
      expect(rule.name).toBe(t(preset.nameKey))
      expect(rule.description).toBe(t(preset.descriptionKey))
      expect(rule.updatedTime, `${preset.id} 必须是未保存草稿`).toBeNull()
      expect(rule.global, `${preset.id} 不应擅自全局生效`).toBe(false)
      expect(rule.actions).toHaveLength(preset.actions.length)
      expect(rule.actions[0].id.startsWith(rule.id)).toBe(true)
      expect(rule.testCases).toHaveLength(1)
      expect(rule.testCases[0].name).toBe(t('rules.presets.testCaseName'))
      // 从模板起手必须记成 `builtin` 并在保存时原样传回去：这是遥测里
      // 「内建模板有人用吗」唯一的信息来源（见 `@common/telemetry` 的 `rewrite_rule_created`）。
      expect(rule.source, `${preset.id} 应从模板起手`).toBe('builtin')
    }
  })

  it('空白规则是只有一个占位 Header 动作的草稿', () => {
    const rule = createBlankRule(t)
    expect(rule.name).toBe(t('rules.untitled'))
    expect(rule.actions).toHaveLength(1)
    expect(rule.actions[0]).toMatchObject({ target: 'header', operation: 'set', path: '', value: '' })
    expect(rule.updatedTime).toBeNull()
    // 自己写的就是 `user`：与模板草稿区分开，两者不能同档。
    expect(rule.source).toBe('user')
  })
})
