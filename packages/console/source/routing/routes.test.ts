import { describe, expect, it } from 'vitest'
import { appNavigationItems } from './navigation'
import { routePaths } from './routes'

/*
 * 路由路径表的唯一事实来源。
 *
 * 这里断言的是「几个必须成立的约定」，而不是把表原样抄一遍：
 * 路径名与 `pages/<module>/` 目录一一对应、带参数的两个页面不在侧栏一级导航里、
 * 拼接与匹配只有一套规则（没有可选段、没有模板占位符以外的花样）。
 */

// 整屏页：没有侧栏，因此不进「一级页面 = 侧栏入口」这条约束。
// 标注成 `string[]` 而不是让它推成两个字面量的元组：下面要拿它去 `includes` 任意一条路径。
const FULL_SCREEN_PATHS: readonly string[] = [routePaths.onboarding, routePaths.login]

describe('routePaths', () => {
  it('每个路径都是绝对的斜杠开头路径', () => {
    for (const value of Object.values(routePaths)) {
      expect(value.startsWith('/')).toBe(true)
      expect(value).not.toMatch(/\/$/)
    }
  })

  it('路径名与模块目录一一对应（不再出现 /providers 叫 model-management 这种两套名字）', () => {
    expect(routePaths.modelManagement).toBe('/model-management')
    expect(routePaths.requestLogs).toBe('/request-logs')
    expect(routePaths.runtimeSettings).toBe('/runtime-settings')
    expect(routePaths.logicalModels).toBe('/logical-models')
  })

  it('语言与主题不参与路径（它们是查询串里的视图参数）', () => {
    for (const value of Object.values(routePaths)) {
      expect(value).not.toContain('lang')
      expect(value).not.toContain('theme')
      expect(value).not.toContain('?')
    }
  })

  it('只有两个页面带路径参数', () => {
    const parameterized = Object.values(routePaths).filter(value => value.includes('$'))
    expect(parameterized.sort()).toEqual(['/client-config/$clientKey', '/overview/$providerId'])
  })

  it('带参数的页面都是某个一级页面的子路径（下钻不能凭空多出一棵根）', () => {
    expect(routePaths.overviewProvider.startsWith(`${routePaths.overview}/`)).toBe(true)
    expect(routePaths.clientConfigDetail.startsWith(`${routePaths.clientConfig}/`)).toBe(true)
  })

  it('没有重复路径', () => {
    const values = Object.values(routePaths)
    expect(new Set(values).size).toBe(values.length)
  })

  it('13 个页面：2 个整屏页 + 9 个一级页 + 2 个下钻', () => {
    const values = Object.values(routePaths)
    const drillDowns = values.filter(value => value.includes('$'))
    const firstLevel = values.filter(value => !value.includes('$') && !FULL_SCREEN_PATHS.includes(value))

    expect(values).toHaveLength(13)
    expect(drillDowns).toHaveLength(2)
    expect(firstLevel).toHaveLength(9)
    // 一级页面的数量必须与侧栏一致，否则会出现「路由有、点不到」的页面。
    expect(firstLevel).toHaveLength(appNavigationItems.length)
  })

  it('每个一级页面都在侧栏里有一个入口，路径与文案一一对应', () => {
    const navPaths = appNavigationItems.map(item => item.to)
    const firstLevel = Object.values(routePaths).filter(value => !value.includes('$') && !FULL_SCREEN_PATHS.includes(value))

    expect(new Set(navPaths)).toEqual(new Set(firstLevel))
  })
})
