/**
 * 共享规则目录的编排层：把「本机的规则」与「目录里的规则」这两种形状接上。
 *
 * 四个动作：浏览（`list` / `get`）只是转发；**发布**把一条本机规则转成载荷送上目录；
 * **使用**把目录里的一条拷进本机规则库，并把它的用量 +1。
 *
 * ## 保存即用，没有「安装」这一步
 *
 * 「使用」直接落到 `createRequestRewriteRule`，得到一条普通的本机规则——它之后和用户自建的
 * 规则走完全相同的路（可编辑、可绑定、可删除），没有「它来自目录所以行为不同」这一说。
 * 来源标成 `imported`，那是**本机的**标注，用于界面区分，不写回目录。
 *
 * ## 计数的写入失败了，也不回滚保存
 *
 * 「使用」的顺序是：先把规则拷进本机库，再尽最大努力给目录的计数 +1。若那一次网络写了失败，
 * 只记一行 debug，**不让用户已经到手的规则因为一个计数器而丢失**。代价是计数可能略微偏低——
 * 而排名本来就是「值不值得试」的近似，宁可少算一次，不可让一次保存落空。
 */

import { RequestRewriteRuleSchema, type RequestRewriteRule } from '@common/schemas'
import {
  SharedRewriteRulePayloadSchema,
  sharedRewriteRuleDisabledReason,
  type SharedRewriteRule,
  type SharedRewriteRuleGetInput,
  type SharedRewriteRuleListInput,
  type SharedRewriteRuleListResult,
  type SharedRewriteRulePayload,
} from '@common/shared-rewrite-rules'
import { AppError } from '@server/errors'
import { createRequestRewriteRule, getRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { getSharedRule, listSharedRules, publishSharedRule, useSharedRule } from './client'

export function browseSharedRules(input: SharedRewriteRuleListInput): Promise<SharedRewriteRuleListResult> {
  return listSharedRules(input)
}

export function readSharedRule(input: SharedRewriteRuleGetInput): Promise<SharedRewriteRule> {
  return getSharedRule(input)
}

/**
 * 把一条规则发布到目录。
 *
 * 入参是「本机的一条规则」而不是载荷：界面上的动作是「把这条规则分享出去」，它手里握着的正是
 * 一条完整的本机规则。这里负责剥掉存储事实（`id` / 时间戳）与本机状态（`enabled` / `source`），
 * 只把作者撰写的那一半送上目录——目录**不重新定义**一条规则，它是 `RequestRewriteRuleSchema`
 * 的一个子集（见契约的 `SharedRewriteRulePayloadSchema`）。
 *
 * 响应阶段同样在这里挡一道（`sharedRewriteRuleDisabledReason`），与本机保存 / 试跑同源：
 * 能发布却装不回来的规则比目录里根本没有更糟。
 */
export async function publishRuleToDirectory(ruleId: string): Promise<SharedRewriteRule> {
  const rule = await getRequestRewriteRule(ruleId)
  if (!rule) throw new AppError('RESOURCE_NOT_FOUND', 404, `Request rewrite rule not found: ${ruleId}`)

  const payload: SharedRewriteRulePayload = SharedRewriteRulePayloadSchema.parse({
    name: rule.name,
    description: rule.description,
    scope: rule.scope,
    schemaVersion: rule.schemaVersion,
    match: rule.match,
    actions: rule.actions,
    testCases: rule.testCases,
  })
  const disabled = sharedRewriteRuleDisabledReason(payload)
  if (disabled) throw new AppError('RESPONSE_REWRITE_DISABLED', 400, disabled)

  return publishSharedRule(payload)
}

/**
 * 把目录里的一条规则拷进本机规则库。
 *
 * 拷贝出来的规则是**一条普通的本机规则**：`id` 由本机重新生成、`enabled` 默认开、
 * 来源标成 `imported`、`scope` 沿用作者的（作者说是全局就是全局，是本机范围是本机范围）。
 * 它之后可编辑、可绑定、可删除，与自建规则没有任何行为差别。
 */
export async function adoptSharedRule(id: string): Promise<RequestRewriteRule> {
  const shared = await getSharedRule({ id })

  const created = await createRequestRewriteRule(RequestRewriteRuleSchema.omit({ id: true, createdTime: true, updatedTime: true, deletedTime: true }).parse({
    name: shared.name,
    description: shared.description,
    enabled: true,
    scope: shared.scope,
    schemaVersion: shared.schemaVersion,
    source: 'imported',
    match: shared.match,
    actions: shared.actions,
    testCases: shared.testCases,
  }))

  // 计数尽最大努力：保存已经成功，写入失败只记一行，不回滚这条规则（理由见文件头）。
  try {
    await useSharedRule({ id })
  } catch (error) {
    console.debug('[shared-rules] usage count not recorded', error)
  }

  return created
}
