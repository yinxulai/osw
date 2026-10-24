import { requestRewriteRuleApi } from '@/api/models'
import type { RequestRewriteTestResult } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { toApiRuleAction, type RequestRewriteRule, type RuleTestCase } from '../types'
import type { RequestRewriteRule as ApiRequestRewriteRule, RequestRewriteRuleTestCase } from '@common/schemas'

/**
 * 试跑一条规则：把界面上的规则折算成 API 的报文，发出去，拿到结果。
 *
 * 这段折算原先写在 `rule-editor-dialog.tsx` 的 `runTest` 里，与按钮的 `disabled`
 * 状态、loading 图标混在一起。它其实是纯粹的「界面模型 → 接口模型」翻译：`global`
 * 布尔折叠成 `scope`、`actions` 逐条换成 API 形态、试跑用的记录不带时间戳
 * （服务端只拿它算一遍，不落库）。
 *
 * 分开之后有两点好处：这份折算与保存时用的是同一套 `toApiRuleAction`，两处对「这条
 * 规则是什么」不会各说一套；它也终于可以不渲染一棵 React 树就测。
 */
export async function runRuleTest(rule: RequestRewriteRule, testCase: RuleTestCase): Promise<RequestRewriteTestResult> {
  return unwrap(requestRewriteRuleApi.test(toTestRule(rule), toApiTestCase(testCase)))
}

/** 界面上的用例 → 契约用例。多出来的字段一个都不带，少一个字段服务端就有默认值兜底。 */
export function toApiTestCase(testCase: RuleTestCase): RequestRewriteRuleTestCase {
  return {
    id: testCase.id,
    name: testCase.name,
    stage: testCase.stage,
    body: testCase.body,
    headers: testCase.headers,
    clientProtocol: testCase.clientProtocol,
    upstreamProtocol: testCase.upstreamProtocol,
    transport: testCase.transport,
  }
}

/**
 * 界面上的规则 → 试跑用的契约规则。
 *
 * `createdTime` / `updatedTime` 填 0：这是试跑，服务端只拿它算一遍，返回体里也不会
 * 出现这两个字段。`testCases` 清空——试跑的是被测的那一个用例，把整张表再塞回请求里
 * 只是白占带宽。
 */
export function toTestRule(rule: RequestRewriteRule): ApiRequestRewriteRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    scope: rule.global ? 'global' : 'model',
    schemaVersion: 1,
    source: rule.source,
    match: {
      clientProtocols: rule.match.clientProtocols,
      upstreamProtocols: rule.match.upstreamProtocols,
    },
    testCases: [],
    actions: rule.actions.map(toApiRuleAction),
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  }
}
