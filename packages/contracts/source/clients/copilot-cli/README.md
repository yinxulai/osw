# Copilot CLI

GitHub 的终端 Copilot。

## 官方文档

- 配置目录（`~/.copilot`、`COPILOT_HOME`、`settings.json` 为 JSONC）：
  <https://docs.github.com/en/copilot/how-tos/copilot-cli/configure-copilot-cli>
- 产品页：<https://docs.github.com/copilot>

## 来源

`definition.json` 的路径与字段照官方文档整理。

## 要点

- **BYOK 通过环境变量交付**：Copilot CLI 指到自定义（BYOK）provider 只认
  `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_API_KEY` / `COPILOT_MODEL` 这几个环境变量，
  `settings.json` 里既没有地址也没有 provider 表。所以 OSW 把这三项写进自己的
  `~/.copilot/osw.env`（`files[].load`），再在登录 shell 的启动文件里注入一段哨兵区段去
  `source` 它——工具本身不读这个文件，靠 shell 带进进程环境。Windows 下对应 PowerShell
  `$PROFILE` 里的点源片段。
- `settings.json` 里的 `model`（注册表里记作 `copilotModel` 以免与环境变量那份撞名）只决定
  GitHub 托管模型或 `auto`；BYOK 模式下由 `COPILOT_MODEL` 覆盖。
- **不提供 `apply` 的字段**：凭证不由 OSW 代填，`apply` 只登记 `baseUrl` / `apiKey` / `model`
  三个走 env 文件的角色。
