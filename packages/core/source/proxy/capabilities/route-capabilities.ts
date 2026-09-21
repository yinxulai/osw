import type { Protocol } from '@common/schemas'
import { generateId } from '@common/utils'
import type {
  PromptInvocation,
  PromptInvocationResult,
  RunCapabilities,
  ScriptInvocation,
  WorkflowProtocol,
} from '@common/router/types'
import { executeProxyRequest } from '../execution/attempt-executor'
import { proxyTargetPlanner } from '../planners/target-planner'
import { createRequestContext } from '../request/request-context'
import { BufferedProxyResponse } from '../response/proxy-response'
import { getManualModel } from '../routing/manual-routing'
import { executeRouteScript } from './script-sandbox'

/**
 * 路由图运行能力的服务端实现（脚本沙箱 / 提示词调用）。
 *
 * 引擎在 `@common/router` 下，是纯计算：需要「网络」和「隔离运行时」这两个只有主进程
 * 才有的资源时，它只声明 `RunCapabilities` 接口。具体实现放在这里，
 * 于是渲染进程复用同一份引擎做静态推演时，这些节点会明确报「能力未注入」，而不是静默跳过。
 */

/** 提示词调用用的客户端协议：请求协议不是聊天协议时，按 openai-completions 调用。 */
export function promptProtocol(protocol: WorkflowProtocol): Protocol {
  if (protocol === 'openai-completions' || protocol === 'openai-responses' || protocol === 'anthropic-messages') {
    return protocol
  }
  return 'openai-completions'
}

export function buildPromptBody(protocol: Protocol, invocation: PromptInvocation): string {
  const messages = invocation.prompt ? [{ role: 'user', content: invocation.prompt }] : []
  const system = invocation.systemPrompt.trim()

  // `model` 只是占位：真实调用的上游模型名由协议适配器改写（`writeJsonModel`，经封装描述的 `writeModel`）。
  if (protocol === 'openai-responses') {
    return JSON.stringify({
      model: invocation.logicalModelId,
      instructions: system || undefined,
      input: messages,
      temperature: invocation.temperature,
      max_output_tokens: invocation.maxTokens,
    })
  }

  if (protocol === 'anthropic-messages') {
    return JSON.stringify({
      model: invocation.logicalModelId,
      system: system || undefined,
      messages,
      temperature: invocation.temperature,
      max_tokens: invocation.maxTokens,
    })
  }

  return JSON.stringify({
    model: invocation.logicalModelId,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature: invocation.temperature,
    max_tokens: invocation.maxTokens,
  })
}

/** 取内容块文本：数组递归拼接，对象块读 `text`，标量直接转字符串。 */
function blockText(block: unknown): string {
  if (Array.isArray(block)) return block.map(blockText).filter(Boolean).join('')
  if (block && typeof block === 'object') return String((block as Record<string, unknown>).text ?? '')
  if (block === undefined || block === null) return ''
  return String(block)
}

function extractAnthropicReply(payload: Record<string, unknown>): string {
  const blocks = Array.isArray(payload.content) ? payload.content : []
  return blocks.map(blockText).filter(Boolean).join('')
}

function extractResponsesReply(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  const texts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) texts.push(blockText(part))
  }
  return texts.filter(Boolean).join('')
}

function extractCompletionsReply(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const record = first as Record<string, unknown>
  const message = record.message
  // chat completions 的正文在 `choices[0].message.content`（可能是字符串，也可能是 content parts 数组）。
  if (message && typeof message === 'object') return blockText((message as Record<string, unknown>).content)
  // 没有 `message` 时只剩旧版 completions 接口的 `choices[0].text` 一种可能。
  return blockText(record)
}

/** 从各协议的回复体里取出正文：openai 取 `message.content`，anthropic 拼接 `content[].text`。 */
export function extractReplyText(protocol: Protocol, payload: Record<string, unknown>): string {
  if (protocol === 'anthropic-messages') return extractAnthropicReply(payload)
  if (protocol === 'openai-responses') return extractResponsesReply(payload)
  return extractCompletionsReply(payload)
}

/** 把上游回复体文本解析成对象。名字里不带 `Json`：协议层的 `parseJsonObject(body: Buffer)` 解的是**请求体**，两件事不共用一个名字。 */
export function parseReplyObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 用指定逻辑模型跑一次提示词：走的是和真实代理请求同一条通路（含协议转换、密钥、故障转移）。 */
async function executePrompt(invocation: PromptInvocation): Promise<PromptInvocationResult> {
  const startedAt = Date.now()
  const protocol = promptProtocol(invocation.protocol)
  const plan = await proxyTargetPlanner.plan({
    logicalModelId: invocation.logicalModelId,
    clientProtocol: protocol,
    manualModelId: getManualModel(invocation.logicalModelId),
  })

  if (plan.targets.length === 0) {
    return {
      success: false,
      text: '',
      error: plan.detail ?? `Logical model ${invocation.logicalModelId} has no upstream that supports ${protocol}`,
      durationMilliseconds: Date.now() - startedAt,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), invocation.timeoutMilliseconds)

  try {
    const response = new BufferedProxyResponse()
    await executeProxyRequest({
      context: createRequestContext({
        requestId: generateId('req_'),
        logicalModelId: invocation.logicalModelId,
        clientProtocol: protocol,
        method: 'POST',
        path: `/router/prompt/${protocol}`,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        requestBody: Buffer.from(buildPromptBody(protocol, invocation)),
        signal: controller.signal,
      }),
      targets: plan.targets,
      response,
      // 工作流里的模型节点是内部执行：它总是挂在一次客户端请求下面（或画布试跑里），
      // 本身不是「代理替客户端处理的一次请求」，再计一次任务就是重复计数。
      origin: 'internal',
    })

    const durationMilliseconds = Date.now() - startedAt
    const target = plan.targets[0]
    const targetLabel = `${target.providerName} / ${target.providerModelName}`

    if (response.statusCode < 200 || response.statusCode >= 400) {
      return {
        success: false,
        text: '',
        target: targetLabel,
        error: response.failureMessage ?? `Upstream responded with HTTP ${response.statusCode || 502}`,
        durationMilliseconds,
      }
    }

    const parsed = parseReplyObject(response.body)
    if (!parsed) {
      return {
        success: false,
        text: '',
        target: targetLabel,
        error: 'The upstream response is not a JSON object',
        durationMilliseconds,
      }
    }

    return {
      success: true,
      text: extractReplyText(protocol, parsed),
      raw: parsed,
      target: targetLabel,
      durationMilliseconds,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        success: false,
        text: '',
        error: `LLM invocation timed out (> ${invocation.timeoutMilliseconds} ms), aborted`,
        durationMilliseconds: Date.now() - startedAt,
      }
    }
    return {
      success: false,
      text: '',
      error: error instanceof Error ? error.message : String(error),
      durationMilliseconds: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 供路由图执行入口（代理入口、管理端试跑）使用的能力集合。 */
export function createRouteCapabilities(): RunCapabilities {
  return {
    runScript: (invocation: ScriptInvocation) => Promise.resolve(executeRouteScript(invocation)),
    runPrompt: (invocation: PromptInvocation) => executePrompt(invocation),
  }
}
