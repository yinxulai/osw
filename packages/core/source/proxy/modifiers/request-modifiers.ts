import type { Modifier, ModifierContext } from '@server/proxy/contracts'
import type { ProtocolAuthHeaders } from '@common/protocols'
import type { RequestRewriteRule } from '@common/schemas'
import type { ProtocolAdapter } from '@server/proxy/protocols/shared/types'
import type { ToolNameRegistry } from '@server/proxy/protocols/shared/tool-name-registry'
import type { RequestContext } from '@server/proxy/request/request-context'
import { createUpstreamRequestHeaders } from '@server/proxy/response/headers'
import type { RewriteSkippedRule } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'

/**
 * 一次规则评估的结果，供调用方落日志（规则数、命中数、字数变化）。
 *
 * `skippedRules` 带上原因：只报「跳过了 3 条」没法回答用户最想问的那个问题——
 * 「为什么我的规则没生效」。原因是枚举（见 `RewriteSkipReason`），可以直接映射成文案。
 */
export interface RewriteEvaluation {
  appliedRuleIds: string[]
  skippedRuleIds: string[]
  skippedRules: RewriteSkippedRule[]
  bodyBytesBefore: number
  bodyBytesAfter: number
}

export interface RequestModifierOptions {
  /** 客户端协议与上游协议之间的适配器：模型改写、请求默认值、请求体转换都在它里面。 */
  adapter: ProtocolAdapter
  /** 适配器需要的请求投影，正文取客户端原文。 */
  requestContext: RequestContext
  /** 上游真实模型名；模型改写用的就是它。 */
  providerModelName: string
  /**
   * 已经解析好的上游认证头，拆成「替换」与「补齐」两半（凭据只在修改器里出现一次）。
   * 拆开是必要的：`replace` 覆盖客户端带来的同名头，`fill` 只在客户端没带时补上。
   */
  auth: ProtocolAuthHeaders
  rules: readonly RequestRewriteRule[]
  /**
   * 本次尝试的请求上下文，与响应侧共享同一个实例：请求体转换在里面登记
   * 「命名空间工具 ↔ 目标协议工具名」的对应关系（见 `tool-name-registry.ts`）。
   */
  toolNames: ToolNameRegistry
  onRewriteEvaluated(result: RewriteEvaluation): void
}

/**
 * 请求侧修改器：拼出一条真正能发往上游的请求。
 *
 * 顺序固定为「头 → 正文 → 规则」：
 * 1. 头：客户端带了什么就转发什么，只替掉鉴权、逐跳头与与位置相关的头，再补上协议固定头。
 * 2. 正文：模型改写 + 请求默认值 + 协议转换，都在适配器里一次做完。
 * 3. 规则：用户配置在最后介入，改的是「已经属于上游协议」的报文。
 *
 * 三个修改器都**不声明 `scope`**，因为这里没有可排除的形态：`ModifierScope.transports` 说的是
 * 「响应以什么形态回来」（§1.1），而请求总是整份读完再发——没有一个形态能构成
 * 「这个修改器在某种形态下没有能做的事」。
 */
export function createRequestModifiers(options: RequestModifierOptions): Modifier[] {
  return [
    createUpstreamHeadersModifier(options),
    createBodyPrepareModifier(options),
    createRequestRewriteModifier(options),
  ]
}

function createUpstreamHeadersModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'upstream-headers',
    order: 10,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(context: ModifierContext, payload) {
      return {
        body: payload.body,
        headers: createUpstreamRequestHeaders(context.exchange.headers, options.auth, payload.body.length),
      }
    },
  }
}

function createBodyPrepareModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'body-prepare',
    order: 20,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(_context: ModifierContext, payload) {
      // 适配器读的是客户端原文，不是上一步的产物：模型改写与协议转换都以原始请求为输入。
      return { body: options.adapter.prepareRequest(options.requestContext, options.providerModelName, options.toolNames), headers: payload.headers }
    },
  }
}

function createRequestRewriteModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'request-rewrite',
    order: 30,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(context: ModifierContext, payload) {
      const modified = applyRequestRewriteRules(payload.body, payload.headers, options.rules, {
        stage: 'request',
        clientProtocol: context.clientProtocol,
        upstreamProtocol: context.upstreamProtocol,
      })
      options.onRewriteEvaluated({
        appliedRuleIds: modified.appliedRuleIds,
        skippedRuleIds: modified.skippedRuleIds,
        skippedRules: modified.skippedRules,
        bodyBytesBefore: payload.body.length,
        bodyBytesAfter: modified.body.length,
      })
      return { body: modified.body, headers: modified.headers }
    },
  }
}
