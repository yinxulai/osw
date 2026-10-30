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
  加载它——工具本身不读这个文件，靠 shell 带进进程环境。
  POSIX 下是 `.`（点命令）；Windows 下**不能**点源 `.env`（Windows PowerShell 只把 `.ps1`
  当脚本，其余扩展名会交给 ShellExecute「用默认程序打开」，装了 VS Code 的机器上 `.env`
  关联到 `Code.exe`，于是每开一个终端就多一个编辑器窗口且变量一个都没设上），
  托管块里改为逐行解析 `KEY=VALUE` 并 `[Environment]::SetEnvironmentVariable(..., 'Process')`。
- `settings.json` 里的 `model`（注册表里记作 `copilotModel` 以免与环境变量那份撞名）只决定
  GitHub 托管模型或 `auto`；BYOK 模式下由 `COPILOT_MODEL` 覆盖。
- **不提供 `apply` 的字段**：凭证不由 OSW 代填，`apply` 只登记 `baseUrl` / `apiKey` / `model`
  三个走 env 文件的角色。
