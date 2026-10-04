/**
 * 共享规则目录的管理接口：界面通过这三个 / 四个动作与目录对话。
 *
 * 动作与目录端点一一对应（`list` / `get` / `publish` / `use`），命名与本机的
 * `request-rewrite-rule/*` 保持一致，让界面这一侧的调用像在读两组同义的动作。
 *
 * 路由是薄的：校验入参（zod）、交给 `shared-rules/service`、把异常翻译成响应。
 * 「怎么发、发到哪、走不走代理」全在 `shared-rules/client` 里，这一层不认识网络。
 */

import { z } from 'zod'
import {
  SharedRewriteRuleGetInputSchema,
  SharedRewriteRuleListInputSchema,
  SharedRewriteRuleUseInputSchema,
} from '@common/shared-rewrite-rules'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { adoptSharedRule, browseSharedRules, publishRuleToDirectory, readSharedRule } from '../../shared-rules/service'

/** 发布时界面手里握着的是**本机规则 id**：发布是「把这条本机规则分享出去」，不是「把一份载荷发上去」。 */
const PublishSchema = z.object({ id: z.string().min(1) })

export const sharedRewriteRuleRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/shared-rewrite-rule/list', async (_req, res, body) => sendSuccess(res, await browseSharedRules(SharedRewriteRuleListInputSchema.parse(body))))
  .post('/api/shared-rewrite-rule/get', async (_req, res, body) => sendSuccess(res, await readSharedRule(SharedRewriteRuleGetInputSchema.parse(body))))
  .post('/api/shared-rewrite-rule/publish', async (_req, res, body) => {
    const { id } = PublishSchema.parse(body)
    sendSuccess(res, await publishRuleToDirectory(id))
  })
  .post('/api/shared-rewrite-rule/use', async (_req, res, body) => {
    const { id } = SharedRewriteRuleUseInputSchema.parse(body)
    sendSuccess(res, await adoptSharedRule(id))
  })
