# Pi

earendil-works 的极简 agent harness。

## 官方文档

- 设置参考（`defaultProvider` / `defaultModel` / `defaultThinkingLevel`）：
  <https://pi.dev/docs/settings>
- 选择一个模型（`models.json` 的 provider schema：`api` / `baseUrl` / `apiKey`）：
  <https://pi.dev/docs/models>

## 来源

`definition.json` 的路径与字段照官方文档整理。

## 要点

- **跨文件配方**：模型选在 `settings.json`（`defaultProvider` / `defaultModel`），provider 定义在
  `models.json`（`providers.<id>`）。所以 `model` / `provider` 字段不带 `file`（落在第一个文件
  settings.json 上），而 `providerTable` 字段标了 `"file": "~/.pi/agent/models.json"`，
  provider 表项因此写进 models.json。回读模型名时（`clientConfigFillValues`）会在该客户端的
  **全部文件**里找，所以写到 models.json 的那一次不会把用户在 settings.json 里选好的模型丢掉。
- **provider 表项形状**：`{ name, baseUrl, api, apiKey, models }`，其中 `models` 是**数组**
  （每个元素 `{ id, name }`），不是对象——`baseUrl` 带 `/v1` 后缀（本机服务是裸 origin）。
