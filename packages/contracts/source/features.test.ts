/**
 * 功能闸门的契约测试。
 *
 * 这里断言的不是某个界面元素，而是**「关闭入口但不删除能力」这条策略本身**在闸门常量上成立：
 * `RESPONSE_REWRITE_ENABLED` 关着时，`ENABLED_RULE_STAGES` 必须同步收敛——它是渲染层唯一该读
 * 的阶段清单。若哪天有人把开关翻回 `true`，这条用例会失败并提醒：要么同时把渲染层与内核的
 * 入口接回来，要么承认响应阶段重新开放了。两个入口各写一遍判断、慢慢漂移，才是最坏的结果。
 */
import { describe, expect, it } from 'vitest'
import { ENABLED_RULE_STAGES, RESPONSE_REWRITE_ENABLED } from './features'

describe('feature flags', () => {
  it('exposes enabled rule stages as the single derived view of the response-rewrite flag', () => {
    if (RESPONSE_REWRITE_ENABLED) {
      expect(ENABLED_RULE_STAGES).toEqual(['request', 'response'])
    } else {
      // 关闭时「响应」不在可选集合里——但类型 `RuleStage` 本身并没有收窄，
      // 既有数据与既有类型的语义都不变（那是 `delivery-shape.ts` 那根轴的事）。
      expect(ENABLED_RULE_STAGES).toEqual(['request'])
    }
  })
})
