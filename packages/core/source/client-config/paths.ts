import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { findAgentClient, findAgentClientFile, type AgentClientEnvOverride } from '@common/clients'

/**
 * 把注册表里声明的那条 `~/` 路径展开成本机真实路径。
 *
 * 这条函数是**整个功能的安全边界**：管理 API 没有鉴权（只绑回环 + CORS 白名单，
 * 见 `docs/product/security-privacy.md`），所以「写哪个文件」绝不能由调用方给路径。
 * 调用方只能给「客户端 key + 注册表里声明过的那条路径」，两者都对不上就没有路径可写。
 * 返回 `null` 即代表这次请求没有资格碰任何文件。
 *
 * 返回的值一定是绝对路径：`~/` 前缀由**主目录**兜底，`envVar` 只替换它声明的那一段。
 */
export function resolveClientConfigPath(clientKey: string, filePath: string): string | null {
  const client = findAgentClient(clientKey)
  const file = findAgentClientFile(clientKey, filePath)
  if (!client || !file) return null
  return expandDeclaredPath(file.path, file.envVar, homedir(), process.env)
}

/**
 * 展开 `~/xxx`，并按 `envVar` 替换它声明的那段 `~/` 相对前缀。
 *
 * 拆成纯函数（主目录与环境变量都是入参）是为了能在测试里断言展开结果，
 * 不去改真实进程的环境变量、也不去猜这台机器的 `$HOME`。
 */
export function expandDeclaredPath(declaredPath: string, envVar: AgentClientEnvOverride | undefined, home: string, env: NodeJS.ProcessEnv): string {
  if (!declaredPath.startsWith('~/')) {
    throw new Error(`client config path must start with "~/": ${declaredPath}`)
  }

  const relative = declaredPath.slice(2)
  const replaced = applyEnvOverride(relative, envVar, env)
  return resolve(home, replaced)
}

/**
 * 环境变量覆盖的是**目录**，而且覆盖的层级因变量而异：
 * `XDG_CONFIG_HOME` 换掉 `~/.config`，`XDG_DATA_HOME` 换掉 `~/.local/share`（两层）。
 * 所以这里比对的是 `replaces` 那段前缀本身，而不是「`~/` 之后的第一段」。
 *
 * 前缀对不上时**不报错**，只是不覆盖：`replaces` 写错是注册表的数据问题，
 * 由单元测试兜住；运行时宁可退回主目录下的默认位置，也不要因为一个环境变量
 * 就把写入目标指到一个谁也没预期的地方。
 */
function applyEnvOverride(relative: string, envVar: AgentClientEnvOverride | undefined, env: NodeJS.ProcessEnv): string {
  if (!envVar) return relative

  const override = env[envVar.name]?.trim()
  if (!override) return relative

  const replaces = envVar.replaces.startsWith('~/') ? envVar.replaces.slice(2) : envVar.replaces
  if (relative !== replaces && !relative.startsWith(`${replaces}/`)) return relative

  return `${override.replace(/[/\\]+$/, '')}${relative.slice(replaces.length)}`
}
