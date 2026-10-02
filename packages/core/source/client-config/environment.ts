/**
 * 客户端配置写入时用的**环境身份**。
 *
 * 为什么需要这一块：客户端配置文件是**全机只有一份**的（`~/.codex/config.toml`、`~/.pi/agent/*.json`、
 * `~/.claude/settings.json`…）。开发实例与正式实例正是要跑在同一台机器上的，于是「往客户端配置里
 * 写什么 provider 名」就不再是一个常量，而取决于**当前跑的是哪套环境**：
 *
 *   - 正式写 `osw` / `OSW`；
 *   - 开发写 `osw-dev` / `OSW Development`（见 `@common/clients` 的 `resolveLocalProviderIdentity`）。
 *
 * 不这样做的后果很具体：开发时点一下「生成配置」，用户真正在用的那套正式配置就被改到 19300 端口、
 * 指向一个注释掉的地址，而且改回来要靠记忆。
 *
 * 为什么用模块级状态而不是把 `environment` 顺着调用链传下去：management 路由的 `handleApiRequest`
 * 收下 `environment` 之后只用于路径白名单，`HttpRouter` 调 handler 时并不会把它递进去
 * （`handler(req, res, body)`）。为这一个值去改 router 契约、九个 handler 与十几个 service 函数，
 * 换来的只是「少一个模块级变量」。这里沿用 core 里既有的做法——`configureSettingsDefaults`
 * （`database/settings-store.ts`）就是这么把启动期上下文交给模块的，且同样由 `ServerRuntime.start()`
 * 在启动时打一下。默认值取 `production`，所以没配置过的调用点（测试、CLI 的旁路）行为不变。
 */

import type { RuntimeEnvironment } from '@common/runtime-profile'
import { agentClientSupportsLocalProviderEntry, resolveLocalProviderIdentity, type LocalProviderIdentity } from '@common/clients'

let environment: RuntimeEnvironment = 'production'

/** 由宿主在启动时调用一次；见 `ServerRuntime.start()`。 */
export function configureClientConfigEnvironment(next: RuntimeEnvironment): void {
  environment = next
}

/** 仅用于测试：把状态还原成未配置时的样子。 */
export function resetClientConfigEnvironment(): void {
  environment = 'production'
}

export function clientConfigEnvironment(): RuntimeEnvironment {
  return environment
}

/** 当前环境该用的 provider 身份（id + 展示名）。 */
export function currentLocalProviderIdentity(): LocalProviderIdentity {
  return resolveLocalProviderIdentity(environment)
}

/**
 * 这个客户端在**当前环境**下能不能写。
 *
 * 唯一的拦路条件就是「支持多 provider」：一份配置里能并排放两条 provider 表项的客户端，
 * 开发环境写进去的是**另一条**表项，与正式那条共存，互不覆盖。
 *
 * 不支持的客户端（Claude Code 的 `ANTHROPIC_*`、Copilot CLI 的 `COPILOT_PROVIDER_*`）一份配置里
 * 只装得下唯一一套地址与模型，而这两个文件里也没有任何地方能挂两套身份——开发环境写进去就是
 * 直接抢正式环境的位置。这种情况按用户要求**忽略**：宁可不写，也不能把用户正在用的正式配置改掉。
 * 正式环境下这条判断恒为真，不受影响。
 */
export function clientSupportsCurrentEnvironment(clientKey: string): boolean {
  if (environment === 'production') return true
  return agentClientSupportsLocalProviderEntry(clientKey)
}
