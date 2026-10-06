import { describe, expect, it } from 'vitest'
import { getTranslator } from '@/i18n/active'
import { useLanguageStore } from '@/i18n/store'
import { ROUTE_MODE_OPTIONS, routeModeOption } from './route-mode-options'

/*
 * 两个模式并排摆出来的元数据。
 *
 * 这里守的是「对比是逐条对齐的」：用户在弹窗里真正要判断的是「能表达什么 / 怎么改 /
 * 适合什么场景」这三点上选哪个，所以两边必须有同样多的差异点、逐条对得上。
 * 各自罗列各自的优点读起来只是两段广告，比不出差别。
 */

const t = getTranslator('zh-CN')

describe('ROUTE_MODE_OPTIONS', () => {
  it('正好两个模式，顺序是工作流在前、规则在后（顺序即展示顺序）', () => {
    expect(ROUTE_MODE_OPTIONS.map(option => option.value)).toEqual(['workflow', 'rules'])
  })

  it('两个模式各有三条差异点，数量一致（一边加一条时另一边必须一起加）', () => {
    expect(ROUTE_MODE_OPTIONS.map(option => option.traitKeys.length)).toEqual([3, 3])
  })

  it('两个模式的情节图标不一样（同一张卡上不该出现两个相同的图标）', () => {
    const [workflow, rules] = ROUTE_MODE_OPTIONS

    expect(workflow.icon).not.toBe(rules.icon)
  })

  it('每个模式的名称、一句话说明与三条差异点都能翻成中文（键必须真的在目录里）', () => {
    for (const option of ROUTE_MODE_OPTIONS) {
      for (const key of [option.labelKey, option.summaryKey, ...option.traitKeys]) {
        expect(t(key), `${option.value}/${key}`).not.toBe(key)
        expect(t(key).length, `${option.value}/${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('名称与说明是同一个词的那一套（页头、设置行、弹窗不做三套说法）', () => {
    expect(t(routeModeOption('workflow').labelKey)).toBe('工作流编排')
    expect(t(routeModeOption('rules').labelKey)).toBe('路由规则')
  })

  it('差异点是「逐条对齐」的：同一条位置上问的是同一件事', () => {
    const [workflow, rules] = ROUTE_MODE_OPTIONS
    const pairs = workflow.traitKeys.map((key, index) => [key, rules.traitKeys[index]])

    // 三条分别落在「能表达什么 / 怎么改 / 适合什么场景」上，两边的键后缀相同。
    for (const [left, right] of pairs) {
      expect(left.split('.').pop()).toBe(right.split('.').pop())
    }
  })

  it('差异点里不含版本能力：两个模式的版本能力是同一套，属于弹窗说明而不是逐条对比', () => {
    const traits = ROUTE_MODE_OPTIONS.flatMap(option => option.traitKeys)

    expect(traits.every(key => !key.includes('version'))).toBe(true)
  })
})

describe('routeModeOption', () => {
  it('按模式取回对应的元数据', () => {
    expect(routeModeOption('workflow')).toBe(ROUTE_MODE_OPTIONS[0])
    expect(routeModeOption('rules')).toBe(ROUTE_MODE_OPTIONS[1])
  })
})

describe('语言无关性', () => {
  it('同一份键在两本目录里都能取到词，且两种语言的说法不同', () => {
    const en = getTranslator('en')

    for (const option of ROUTE_MODE_OPTIONS) {
      for (const key of [option.labelKey, option.summaryKey, ...option.traitKeys]) {
        expect(en(key), key).not.toBe(key)
        expect(en(key), key).not.toBe(t(key))
      }
    }

    // 取词函数按语言缓存实例，取回中文仍应是同一套说法（不会把缓存串了）。
    useLanguageStore.setState({ preference: 'zh-CN' })
    expect(getTranslator('zh-CN')(routeModeOption('rules').labelKey)).toBe('路由规则')
  })
})
