# VS Code

Visual Studio Code。

## 官方文档

- 语言模型与 BYOK（自带密钥）：
  <https://code.visualstudio.com/docs/agent-customization/language-models>
- `chatLanguageModels.json` 里的 provider / model 配置字段（Custom Endpoint
  一节）：同上一页的 “Model configuration reference”。

## 来源

`definition.json` 的路径与字段照官方文档整理；macOS 的
`~/Library/Application Support/Code/User/` 对应 Linux 的 `~/.config/Code/User/`
与 Windows 的 `~/AppData/Roaming/Code/User/`，写在 `platformPaths` 里。

## 要点

- `chatLanguageModels.json` 的根是一个**数组**：每个元素是一个 provider
  条目，用 `name` 当标识（形状写成 `{ "kind": "entryList", "idField": "name" }`）。
- `apply.providerEntry` 写的是一条 `vendor: customendpoint` 条目，里面显式声明
  一个模型；`path` 用的是 `{{providerName}}`（`OSW`）——条目数组按 `name` 认身份，
  路径必须与模板里的 `name` 字面相等才会命中同一条。
- 省略 provider 级的 `url`：带上它时 VS Code 会去请求 `GET /models` 自行发现模型，
  而不是用我们写好的 `models` 数组。
- 模型 `url` 写完整端点（含 `/v1/chat/completions`），缺省鉴权头是
  `Authorization: Bearer <apiKey>`。
- 这个文件只**声明**可用模型；用户在模型选择器里选中哪个是 VS Code 自己的界面状态，
  不落在这个文件里，所以注册表不为它登记 `model` 角色。
