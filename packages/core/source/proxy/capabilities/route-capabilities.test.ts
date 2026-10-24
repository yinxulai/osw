import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Protocol } from '@common/schemas'
import { readLandingModelIds, runWorkflow } from '@common/router/engine'
import { createLlmComplexityGraph, samplePayload } from '@common/router/presets'
import {
  ALL_WORKFLOW_PROTOCOLS,
  type PromptInvocation,
  type PromptInvocationResult,
  type RouteContextInput,
  type RuntimeLogicalModel,
  type WorkflowGraph,
  type WorkflowNodeModel,
  type WorkflowProtocol,
  type WorkflowRunResult,
} from '@common/router/types'
import type { PlanResult, UpstreamTarget } from '@server/proxy/contracts'
import type { ProxyExecutionOptions } from '@server/proxy/execution/attempt-executor'
import { buildPromptBody, createRouteCapabilities, extractReplyText, parseReplyObject, promptProtocol } from './route-capabilities'

/**
 * 服务端「LLM 节点」能力（提示词请求体构造 / 回复正文提取 / 调用编排）。
 *
 * 引擎侧的 LLM 节点测试全都注入假的 `runPrompt`，只比对调用参数 —— 「按 responses 协议
 * 发出去的请求体里少了 `instructions`」或者「anthropic 的回复被当成 choices 解析成空串」
 * 这类问题一个都拦不住：它们决定的是**上游是否真的读懂了这次调用**。
 *
 * 最后一节把规划器 / 手工锁定 / 执行器换成替身，盯住编排逻辑本身；真实的网络、
 * 密钥、故障转移仍在 `attempt-executor` 里，不在这里重复验证。
 */

const executorMocks = vi.hoisted(() => ({
  plan: vi.fn(),
  execute: vi.fn(),
  getManualModel: vi.fn(),
}))

vi.mock('@server/proxy/planners/target-planner', () => ({
  proxyTargetPlanner: { id: 'proxy-target', plan: executorMocks.plan },
}))

vi.mock('@server/proxy/routing/manual-routing', () => ({ getManualModel: executorMocks.getManualModel }))

vi.mock('@server/proxy/execution/attempt-executor', () => ({ executeProxyRequest: executorMocks.execute }))

const baseInvocation: PromptInvocation = {
  nodeId: 'prompt',
  nodeName: '判断复杂度',
  logicalModelId: 'model-fast',
  protocol: 'openai-completions',
  systemPrompt: 'You are a routing helper.',
  prompt: 'Which model fits?',
  temperature: 0.2,
  maxTokens: 32,
  timeoutMilliseconds: 60_000,
}

function invocation(overrides: Partial<PromptInvocation> = {}): PromptInvocation {
  return { ...baseInvocation, ...overrides }
}

function bodyOf(protocol: Protocol, overrides: Partial<PromptInvocation> = {}): Record<string, unknown> {
  const parsed: unknown = JSON.parse(buildPromptBody(protocol, invocation(overrides)))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('提示词请求体必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

describe('LLM 能力 · 调用协议', () => {
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as Protocol[])('聊天协议 %s 原样透传', (protocol) => {
    expect(promptProtocol(protocol)).toBe(protocol)
  })

  it('认不出协议时按 openai-completions 调用（判定用的模型必须至少能跑）', () => {
    expect(promptProtocol('unknown')).toBe('openai-completions')
  })

  it('四种工作流协议都能得到一个可调用的协议', () => {
    const protocols: WorkflowProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages', 'unknown']

    for (const protocol of protocols) expect(['openai-completions', 'openai-responses', 'anthropic-messages']).toContain(promptProtocol(protocol))
  })
})

describe('LLM 能力 · 请求体构造', () => {
  it('completions：系统提示词作为第一条 message', () => {
    const body = bodyOf('openai-completions')

    expect(body).toMatchObject({
      model: 'model-fast',
      temperature: 0.2,
      max_tokens: 32,
      messages: [
        { role: 'system', content: 'You are a routing helper.' },
        { role: 'user', content: 'Which model fits?' },
      ],
    })
    // completions 不认 `instructions`，写进去会被上游忽略或直接 400。
    expect(body).not.toHaveProperty('instructions')
  })

  it('completions：系统提示词为空时不硬塞一条空 system', () => {
    expect(bodyOf('openai-completions', { systemPrompt: '' })).toMatchObject({ messages: [{ role: 'user', content: 'Which model fits?' }] })
    // 只写了空白也算没写。
    expect(bodyOf('openai-completions', { systemPrompt: '   ' })).toMatchObject({ messages: [{ role: 'user', content: 'Which model fits?' }] })
  })

  it('responses：系统提示词走 instructions，输出上限叫 max_output_tokens', () => {
    const body = bodyOf('openai-responses')

    expect(body).toMatchObject({
      model: 'model-fast',
      instructions: 'You are a routing helper.',
      input: [{ role: 'user', content: 'Which model fits?' }],
      max_output_tokens: 32,
    })
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('responses：没有系统提示词时不带 instructions 字段', () => {
    expect(bodyOf('openai-responses', { systemPrompt: '' })).not.toHaveProperty('instructions')
  })

  it('anthropic：系统提示词走顶层 system，消息里只留 user', () => {
    const body = bodyOf('anthropic-messages')

    expect(body).toMatchObject({
      model: 'model-fast',
      system: 'You are a routing helper.',
      messages: [{ role: 'user', content: 'Which model fits?' }],
      max_tokens: 32,
    })
    expect(body).not.toHaveProperty('instructions')
  })

  it('anthropic：没有系统提示词时不带 system 字段', () => {
    expect(bodyOf('anthropic-messages', { systemPrompt: '' })).not.toHaveProperty('system')
  })

  it('空提示词不会伪造一条空消息（三种协议一致）', () => {
    expect(bodyOf('openai-completions', { prompt: '', systemPrompt: '' })).toMatchObject({ messages: [] })
    expect(bodyOf('openai-responses', { prompt: '', systemPrompt: '' })).toMatchObject({ input: [] })
    expect(bodyOf('anthropic-messages', { prompt: '', systemPrompt: '' })).toMatchObject({ messages: [] })
  })

  it('三种协议的请求体都是合法 JSON，且带上逻辑模型 id 与采样参数', () => {
    for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages'] as Protocol[]) {
      const body = bodyOf(protocol, { logicalModelId: 'model-smart', temperature: 1, maxTokens: 512 })

      expect(body.model).toBe('model-smart')
      expect(body.temperature).toBe(1)
      expect(JSON.stringify(body)).not.toContain('undefined')
    }
  })
})

describe('LLM 能力 · 回复体解析', () => {
  it('只接受 JSON 对象', () => {
    expect(parseReplyObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseReplyObject('[{"a":1}]')).toBeNull()
    expect(parseReplyObject('"text"')).toBeNull()
    expect(parseReplyObject('42')).toBeNull()
    expect(parseReplyObject('null')).toBeNull()
    expect(parseReplyObject('not json')).toBeNull()
    expect(parseReplyObject('')).toBeNull()
  })
})

describe('LLM 能力 · 回复正文提取', () => {
  it('completions：取 choices[0].message.content', () => {
    expect(extractReplyText('openai-completions', { choices: [{ message: { role: 'assistant', content: 'complex' } }] })).toBe('complex')
  })

  it('completions：content 是内容块数组时拼起来', () => {
    const payload = { choices: [{ message: { content: [{ type: 'text', text: 'com' }, { type: 'text', text: 'plex' }] } }] }

    expect(extractReplyText('openai-completions', payload)).toBe('complex')
  })

  it('completions：拿不到正文时返回空串，绝不把整个回复体当答案', () => {
    // 有些上游失败时只回一个 finish_reason，这时判定必须退化成「认不出」，而不是把 JSON 文本当回复。
    expect(extractReplyText('openai-completions', { choices: [{ index: 0, finish_reason: 'stop' }] })).toBe('')
    expect(extractReplyText('openai-completions', { choices: [] })).toBe('')
    expect(extractReplyText('openai-completions', {})).toBe('')
    expect(extractReplyText('openai-completions', { choices: [{ message: { content: null } }] })).toBe('')
  })

  it('completions：没有 message 时兼容旧版接口的 choices[0].text', () => {
    expect(extractReplyText('openai-completions', { choices: [{ text: 'complex', finish_reason: 'stop' }] })).toBe('complex')
  })

  it('anthropic：拼接 content[].text，忽略非文本块', () => {
    const payload = { content: [{ type: 'text', text: 'com' }, { type: 'thinking', text: '' }, { type: 'text', text: 'plex' }] }

    expect(extractReplyText('anthropic-messages', payload)).toBe('complex')
  })

  it('anthropic：嵌套数组与标量块都能取到文本', () => {
    expect(extractReplyText('anthropic-messages', { content: [[{ text: 'a' }], { text: 'b' }, 'c', null, undefined] })).toBe('abc')
  })

  it('anthropic：没有 content 时返回空串', () => {
    expect(extractReplyText('anthropic-messages', {})).toBe('')
    expect(extractReplyText('anthropic-messages', { content: 'complex' })).toBe('')
  })

  it('responses：优先用 output_text 便捷字段', () => {
    expect(extractReplyText('openai-responses', { output_text: 'complex', output: [{ content: [{ text: '不该被用到' }] }] })).toBe('complex')
  })

  it('responses：没有 output_text 时从 output[].content[] 拼文本', () => {
    const payload = {
      output: [
        { type: 'reasoning', content: [{ type: 'summary_text', text: '想一下' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'com' }, { type: 'output_text', text: 'plex' }] },
      ],
    }

    expect(extractReplyText('openai-responses', payload)).toBe('想一下complex')
  })

  it('responses：不合法结构一律返回空串', () => {
    expect(extractReplyText('openai-responses', {})).toBe('')
    expect(extractReplyText('openai-responses', { output: [{ content: 'not-an-array' }, 'not-an-object', null] })).toBe('')
  })

  it('三种协议拿不到正文时给的都是空字符串而不是 undefined', () => {
    for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages'] as Protocol[]) {
      expect(extractReplyText(protocol, {})).toBe('')
    }
  })
})

/* ------------------------------------------------------------------------- *
 * 调用编排：规划器 / 手工锁定 / 执行器都是替身
 * ------------------------------------------------------------------------- */

function upstreamTarget(providerName: string, providerModelName: string): UpstreamTarget {
  return {
    providerId: `prov_${providerModelName}`,
    providerName,
    providerModelId: `pm_${providerModelName}`,
    providerModelName,
    apiKeyReference: 'key',
    customAuthHeader: null,
    endpointId: `endpoint_${providerModelName}`,
    protocol: 'openai-completions',
    url: `https://example.test/${providerModelName}`,
    timeoutMilliseconds: 30_000,
  }
}

function planOf(...targets: UpstreamTarget[]): PlanResult {
  return { targets, reason: targets.length > 0 ? 'none' : 'no-available-provider' }
}

/** 让执行器「什么都没写」：模拟上游连接直接断掉，连响应头都没出来。 */
function respondNothing(): void {
  executorMocks.execute.mockImplementation(async () => undefined)
}

/** 让执行器按真实执行器的写法回一个响应（先 start 再 write、end），顺带返回它收到的参数。 */
function respondJson(statusCode: number, payload: unknown): ProxyExecutionOptions[] {
  const seen: ProxyExecutionOptions[] = []
  executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
    seen.push(options)
    options.response.start(statusCode, { 'content-type': 'application/json' })
    options.response.write(JSON.stringify(payload))
    options.response.end()
  })
  return seen
}

/** 记录执行器收到的参数（但不写响应），供断言「请求上下文是怎么拼的」。 */
function captureExecution(): ProxyExecutionOptions[] {
  const seen: ProxyExecutionOptions[] = []
  executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
    seen.push(options)
  })
  return seen
}

async function callPrompt(overrides: Partial<PromptInvocation> = {}): Promise<PromptInvocationResult> {
  const capabilities = createRouteCapabilities()
  const runPrompt = capabilities.runPrompt
  if (!runPrompt) throw new Error('能力集合里必须有 runPrompt')
  return runPrompt(invocation(overrides))
}

beforeEach(() => {
  executorMocks.plan.mockReset()
  executorMocks.execute.mockReset()
  executorMocks.getManualModel.mockReset().mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LLM 能力 · 调用编排', () => {
  it('能力集合只暴露脚本与提示词两件事', () => {
    const capabilities = createRouteCapabilities()

    expect(Object.keys(capabilities).sort()).toEqual(['runPrompt', 'runScript'])
    expect(typeof capabilities.runScript).toBe('function')
    expect(typeof capabilities.runPrompt).toBe('function')
  })

  // 能力层的 `runScript` 必须真的把脚本交给沙箱跑，而不是自己再写一份执行逻辑：
  // 引擎只认这个接口，一旦这里退化成空实现，脚本节点会静默变成「什么都没做」。
  it('runScript 直接把脚本交给沙箱执行', async () => {
    const capabilities = createRouteCapabilities()
    const handle = capabilities.runScript
    if (!handle) throw new Error('能力集合里必须有 runScript')

    const result = await handle({
      nodeId: 'script',
      nodeName: '脚本',
      code: 'console.log("hi"); return payload.request.body.model',
      payload: { request: { body: { model: 'gpt-4o' } } },
      timeoutMilliseconds: 500,
    })

    expect(result).toMatchObject({ success: true, value: 'gpt-4o', logs: ['[log] hi'] })
  })

  it('计划里一个候选都没有时直接失败，连请求都不发', async () => {
    executorMocks.plan.mockResolvedValue({ targets: [], reason: 'no-available-provider', detail: '这个逻辑模型没有可用的上游' })

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.text).toBe('')
    expect(result.error).toBe('这个逻辑模型没有可用的上游')
    expect(result.durationMilliseconds).toBeGreaterThanOrEqual(0)
    expect(executorMocks.execute).not.toHaveBeenCalled()
  })

  it('计划没给出原因时，兜底文案带上逻辑模型与最终调用的协议', async () => {
    executorMocks.plan.mockResolvedValue({ targets: [], reason: 'none' })

    // 请求协议认不出时应按 completions 调用，错误文案必须说协议「实际用了哪个」。
    const result = await callPrompt({ protocol: 'unknown' })

    expect(result.error).toBe('Logical model model-fast has no upstream that supports openai-completions')
  })

  it('成功时把正文、命中的上游与耗时一起交回', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    respondJson(200, { content: [{ type: 'text', text: 'complex' }] })

    const result = await callPrompt({ protocol: 'anthropic-messages' })

    expect(result.success).toBe(true)
    expect(result.text).toBe('complex')
    expect(result.target).toBe('Acme / fast-1')
    expect(result.raw).toEqual({ content: [{ type: 'text', text: 'complex' }] })
    expect(result.durationMilliseconds).toBeGreaterThanOrEqual(0)
  })

  it('请求按真实代理通路拼装：协议、路径、请求体与手工锁定都传下去', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'smart-1')))
    executorMocks.getManualModel.mockReturnValue('locked-1')
    const seen = captureExecution()

    await callPrompt({ protocol: 'openai-responses' })

    expect(executorMocks.getManualModel).toHaveBeenCalledWith('model-fast')
    expect(executorMocks.plan).toHaveBeenCalledWith({
      logicalModelId: 'model-fast',
      clientProtocol: 'openai-responses',
      manualModelId: 'locked-1',
    })

    const options = seen[0]
    expect(options.context.requestId.startsWith('req_')).toBe(true)
    expect(options.context.logicalModelId).toBe('model-fast')
    expect(options.context.clientProtocol).toBe('openai-responses')
    expect(options.context.method).toBe('POST')
    expect(options.context.path).toBe('/router/prompt/openai-responses')
    expect(options.context.headers).toMatchObject({ accept: 'application/json', 'content-type': 'application/json' })
    expect(JSON.parse(options.context.requestBody.toString())).toEqual(bodyOf('openai-responses'))
  })

  it('上游没有可读响应时按 502 兜底', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    respondNothing()

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.error).toBe('Upstream responded with HTTP 502')
    expect(result.target).toBe('Acme / fast-1')
  })

  it('上游非 2xx 时退回 HTTP 状态码，并说明打到了哪个上游', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
      options.response.fail(429, 'rate_limited', '上游限流')
    })

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.error).toBe('Upstream responded with HTTP 429')
    expect(result.target).toBe('Acme / fast-1')
  })

  it('上游有明确的失败信息时优先用它', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
      options.response.start(503, { 'content-type': 'application/json' })
      options.response.destroy(new Error('所有上游都不可用'))
    })

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.error).toBe('所有上游都不可用')
  })

  it('上游回复不是 JSON 对象时如实报错，不把原文当正文', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
      options.response.start(200, { 'content-type': 'text/plain' })
      options.response.write('complex')
      options.response.end()
    })

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.text).toBe('')
    expect(result.error).toBe('The upstream response is not a JSON object')
  })

  it('超过超时上限被中止时给的是超时文案', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => await new Promise((_resolve, reject) => {
      options.context.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')))
    }))

    const result = await callPrompt({ timeoutMilliseconds: 20 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('LLM invocation timed out (> 20 ms), aborted')
    expect(result.target).toBeUndefined()
  })

  it('上游没超时但直接抛错时，原样上报错误文案', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockRejectedValue(new Error('上游连接被重置'))

    const result = await callPrompt()

    expect(result.success).toBe(false)
    expect(result.error).toBe('上游连接被重置')
  })

  it('抛出的不是 Error 时也能变成可读文案', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockRejectedValue('炸了')

    const result = await callPrompt()

    expect(result.error).toBe('炸了')
  })

  it('调用结束后一定清掉超时定时器，不挂住进程', async () => {
    vi.useFakeTimers()
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    respondJson(200, { choices: [{ message: { content: 'complex' } }] })

    await callPrompt()

    expect(vi.getTimerCount()).toBe(0)
  })
})

/* ------------------------------------------------------------------------- *
 * 内置策略 × 真实能力：整条链路（引擎 → 能力 → 编排 → 回复解析 → 落点）
 * ------------------------------------------------------------------------- */

const policyModels: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-smart', enabled: true },
]

/**
 * 跑一次「LLM 复杂度分流」预设，`createRouteCapabilities()` 是真的，只有最外面那层
 * 「把请求发到上游」是替身 —— 于是「上游回来的 body 到底能不能被判定节点读懂」
 * 这件事第一次有了断言。缺了这条，回复解析取错字段只会表现成「复杂分支永远不生效」。
 *
 * `discover: true` 会在入口与判定节点之间接一道协议发现节点：预设自己不带这个节点
 * （提示词拼的是整包请求，协议无关），但只有接上它，「发现到的协议」才会传到
 * LLM 能力层，判定调用才会按 anthropic / responses 的协议真正下发。
 */
type ComplexityRunOptions = { discover?: boolean }

async function runComplexityPolicy(protocol: WorkflowProtocol, options: ComplexityRunOptions = {}): Promise<WorkflowRunResult> {
  const preset = createLlmComplexityGraph(policyModels)
  const graph = options.discover ? withProtocolDiscovery(preset) : preset
  const input: RouteContextInput = { request: samplePayload.request, logicalModels: policyModels, protocol }

  return runWorkflow(graph, input, { capabilities: createRouteCapabilities() })
}

/** 给预设图前面接一道协议发现节点（脚本预设就是这么接的），四种协议分支全接判定节点。 */
function withProtocolDiscovery(graph: WorkflowGraph): WorkflowGraph {
  const discovery: WorkflowNodeModel = {
    id: 'discovery',
    kind: 'protocol-discovery',
    name: '协议发现',
    enabled: true,
    description: '',
    position: { x: 260, y: 300 },
  }

  return {
    ...graph,
    nodes: [...graph.nodes, discovery],
    edges: [
      ...graph.edges.filter(item => item.id !== 'edge-input-prompt'),
      { id: 'edge-input-discovery', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'discovery' },
      ...ALL_WORKFLOW_PROTOCOLS.map(protocol => ({
        id: `edge-discovery-${protocol}`,
        sourceNodeId: 'discovery',
        sourcePort: protocol,
        targetNodeId: 'complexity-prompt',
      })),
    ],
  }
}

describe('内置策略 · LLM 复杂度分流接真实能力', () => {
  it('completions 上游回 complex 时落到复杂落点，判定值留在决策数据里', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    const seen = respondJson(200, { choices: [{ index: 0, message: { role: 'assistant', content: 'complex' }, finish_reason: 'stop' }] })

    const result = await runComplexityPolicy('openai-completions')

    expect(readLandingModelIds(result.outputPayload)).toEqual(['model-smart'])
    expect((result.outputPayload as { route: Record<string, unknown> }).route.complexity).toBe('complex')
    expect(result.stopReason).toBe('output')
    // 判定用的模型必须是兜底逻辑模型（拿真实模型去判定会把成本算到客户头上）。
    expect(JSON.parse(seen[0].context.requestBody.toString())).toMatchObject({ model: 'default' })
  })

  it('completions 上游把正文放在 content 块数组里时同样命中复杂分支', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    respondJson(200, { choices: [{ message: { content: [{ type: 'text', text: 'com' }, { type: 'text', text: 'plex' }] } }] })

    const result = await runComplexityPolicy('openai-completions')

    expect(readLandingModelIds(result.outputPayload)).toEqual(['model-smart'])
  })

  it('预设不带协议发现节点，判定调用固定按 openai-completions 形状下发', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    const seen = respondJson(200, { choices: [{ message: { content: 'complex' } }] })

    // 入口节点只把「调用方声明的协议」写进 route.protocol；没经过协议发现节点，
    // 引擎交给能力的协议仍是 unknown，能力层按最保守的 completions 形状下发。
    const result = await runComplexityPolicy('anthropic-messages')

    expect((result.outputPayload as { route: Record<string, unknown> }).route.protocol).toBe('anthropic-messages')
    expect(seen[0]?.context.path).toBe('/router/prompt/openai-completions')
    expect(seen[0]?.targets[0]?.protocol).toBe('openai-completions')
    expect(readLandingModelIds(result.outputPayload)).toEqual(['model-smart'])
  })

  it('接上协议发现节点后，anthropic 的 content 块与 responses 的 output_text 都能判定成复杂', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    const anthropicSeen = respondJson(200, { content: [{ type: 'text', text: 'complex' }] })

    const anthropic = await runComplexityPolicy('anthropic-messages', { discover: true })

    expect(anthropicSeen[0]?.context.path).toBe('/router/prompt/anthropic-messages')
    expect(readLandingModelIds(anthropic.outputPayload)).toEqual(['model-smart'])

    const responsesSeen = respondJson(200, { output_text: 'complex' })

    const responses = await runComplexityPolicy('openai-responses', { discover: true })

    expect(responsesSeen[0]?.context.path).toBe('/router/prompt/openai-responses')
    expect(readLandingModelIds(responses.outputPayload)).toEqual(['model-smart'])
  })

  it('上游回 simple 时走其余分支，落到兜底落点', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    respondJson(200, { choices: [{ message: { content: 'simple' } }] })

    const result = await runComplexityPolicy('openai-completions')

    expect(readLandingModelIds(result.outputPayload)).toEqual(['default'])
  })

  it('上游失败时读不到判定值，退回其余分支而不是把整次路由卡死', async () => {
    executorMocks.plan.mockResolvedValue(planOf(upstreamTarget('Acme', 'fast-1')))
    executorMocks.execute.mockImplementation(async (options: ProxyExecutionOptions) => {
      options.response.fail(500, 'upstream_error', '上游炸了')
    })

    const result = await runComplexityPolicy('openai-completions')

    expect((result.outputPayload as { route: Record<string, unknown> }).route.complexity).toBeUndefined()
    expect(readLandingModelIds(result.outputPayload)).toEqual(['default'])
    expect(result.stopReason).toBe('output')
  })
})
