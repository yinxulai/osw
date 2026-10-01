/**
 * 内置脚本的**真实执行**覆盖。
 *
 * 渲染层已有一份结构门禁（`rewrite-script-samples.test.ts`），但它只能证明字符串「能作为
 * 函数体解析」——那是最弱的一档，一段永远 `throw` 的代码也能过。真正要回答的问题是：
 * **用户点开示例、直接保存，这条规则会不会按承诺生效？** 这只有把它丢进沙箱跑一遍才知道。
 *
 * 因此这里不重写脚本、也不重抄字符串：直接 import `@common/rewrite-script-samples` 里
 * 那份**同一份**定义（用户在编辑器里看到的就是它），逐条执行并断言结果。为了让「新增一个
 * 示例」无法绕过覆盖，用例会遍历 `REWRITE_SCRIPT_SAMPLES`，并要求每个 id 都出现在下面的
 * 夹具表里——漏一个就失败，而不是悄悄少测一条。
 */

import { describe, expect, it } from 'vitest'
import type { RequestRewriteRule, RequestRewriteRuleAction } from '@common/schemas'
import { PRESET_CONDITIONAL_SCRIPT_CODE, REWRITE_SCRIPT_SAMPLES } from '@common/rewrite-script-samples'
import { applyRequestRewriteRules } from './request-rewrite-engine'

function scriptRule(code: string, stage: 'request' | 'response'): RequestRewriteRule {
  const action: RequestRewriteRuleAction = { type: 'script', stage, code, timeoutMilliseconds: 1000 }
  return {
    id: 'builtin-script',
    name: '内置脚本执行覆盖',
    description: '',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'builtin',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [action],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
  }
}

interface ScriptFixture {
  /** 该示例作用在哪个阶段；响应示例只有在非流式（整包）下才会真正执行。 */
  stage: 'request' | 'response'
  body: unknown
  headers?: Record<string, string>
  /** 执行后的断言：拿到解析后的 body 与最终 headers，自行断言。 */
  expect: (context: { body: unknown; headers: Record<string, string | string[] | undefined> }) => void
}

/**
 * 每个内置脚本一份夹具，逐条断言它**真的做了承诺的那件事**。
 *
 * key 必须覆盖 `REWRITE_SCRIPT_SAMPLES` 的全部 id（下面有专门用例把关）。
 */
const FIXTURES: Record<string, ScriptFixture> = {
  'request-baseline': {
    stage: 'request',
    body: { model: 'demo', temperature: 1 },
    expect: ({ body }) => { expect((body as { temperature: number }).temperature).toBe(0) },
  },
  'response-baseline': {
    stage: 'response',
    body: { id: 'abc', choices: [] },
    expect: ({ body }) => { expect((body as { id: string }).id).toBe('rw-abc') },
  },
  'drop-body-field': {
    stage: 'request',
    body: { metadata: { source: 'old' }, keep: 1 },
    expect: ({ body }) => {
      expect(body).toEqual({ keep: 1 })
      expect(Object.hasOwn(body as object, 'metadata')).toBe(false)
    },
  },
  'filter-headers': {
    stage: 'request',
    body: {},
    headers: { 'X-Debug': '1', 'X-Internal-Trace': '2', 'X-Keep': 'yes' },
    expect: ({ headers }) => {
      expect(headers['X-Keep']).toBe('yes')
      expect(Object.keys(headers).map(key => key.toLowerCase())).not.toContain('x-debug')
      expect(Object.keys(headers).map(key => key.toLowerCase())).not.toContain('x-internal-trace')
    },
  },
  conditional: {
    stage: 'request',
    body: { marker: 'apply-strict', temperature: 1 },
    expect: ({ body }) => { expect((body as { temperature: number }).temperature).toBe(0) },
  },
}

function run(code: string, stage: 'request' | 'response', body: unknown, headers: Record<string, string> = {}) {
  const result = applyRequestRewriteRules(
    Buffer.from(JSON.stringify(body)),
    { ...headers },
    [scriptRule(code, stage)],
    { stage, clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', ...(stage === 'response' ? { shape: 'whole' as const } : {}) },
  )
  return { body: JSON.parse(result.body.toString('utf8')) as unknown, headers: result.headers, applied: result.appliedRuleIds, logs: result.scriptLogs }
}

describe('内置脚本执行', () => {
  it('夹具覆盖了每一个示例：新增示例不补夹具就会失败', () => {
    const sampleIds = REWRITE_SCRIPT_SAMPLES.map(sample => sample.id).sort()
    expect(Object.keys(FIXTURES).sort()).toEqual(sampleIds)
  })

  it.each(REWRITE_SCRIPT_SAMPLES.map(sample => [sample.id, sample] as const))('示例 %s 真正执行并按承诺生效', (id, sample) => {
    const fixture = FIXTURES[id]
    expect(fixture, `缺少 ${id} 的执行夹具`).toBeDefined()
    // 夹具声明的阶段必须和示例自身的阶段一致，否则就是在拿一段响应脚本当请求脚本跑。
    expect(fixture.stage, `${id} 的夹具阶段与示例不符`).toBe(sample.stage)
    const outcome = run(sample.code, fixture.stage, fixture.body, fixture.headers)
    // 能被应用（而不是被跳过 / 抛错），才说明这段示例真的在这条链路上跑起来了。
    expect(outcome.applied, `${id} 没有被应用`).toEqual(['builtin-script'])
    fixture.expect(outcome)
  })

  it('条件示例在不命中时保持原样（不 return 即整条不改动）', () => {
    const outcome = run(REWRITE_SCRIPT_SAMPLES.find(sample => sample.id === 'conditional')!.code, 'request', { temperature: 1 })
    expect(outcome.applied).toEqual(['builtin-script'])
    expect(outcome.body).toEqual({ temperature: 1 })
  })

  it('规则模板自带的脚本真正执行且两种分支都成立', () => {
    const strict = run(PRESET_CONDITIONAL_SCRIPT_CODE, 'request', { marker: 'apply-strict', temperature: 1 })
    expect(strict.body).toEqual({ marker: 'apply-strict', temperature: 0 })
    const relaxed = run(PRESET_CONDITIONAL_SCRIPT_CODE, 'request', { temperature: 1 })
    expect(relaxed.body).toEqual({ temperature: 1 })
    // 未命中分支会打一行日志，证明它确实走进了「不改动」那条路，而不是压根没执行。
    expect(relaxed.logs.join('\n')).toContain('skipping')
  })

  it('响应示例在流式形态下被跳过——这正是要显式提示、不能静默的那个边界', () => {
    const responseSample = REWRITE_SCRIPT_SAMPLES.find(sample => sample.stage === 'response')!
    const result = applyRequestRewriteRules(
      Buffer.from(JSON.stringify({ id: 'abc' })),
      {},
      [scriptRule(responseSample.code, 'response')],
      { stage: 'response', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', shape: 'incremental' },
    )
    expect(result.appliedRuleIds).toEqual([])
    expect(result.skippedRules).toEqual([{ ruleId: 'builtin-script', reason: 'unsupported-shape' }])
  })
})
