# OpenCode

开源终端 agent。

## 官方文档

- 配置（`opencode.json` / `opencode.jsonc`、`model` / `small_model`、provider 表）：
  <https://opencode.ai/docs/config/>
- Provider（`npm` / `options.baseURL` / `options.apiKey` / `models`）：
  <https://opencode.ai/docs/providers/>
- 模型清单：<https://opencode.ai/docs/models/>

## 来源

`definition.json` 的路径与字段照官方文档整理。

## 要点

- XDG：配置在 `$XDG_CONFIG_HOME/opencode/`，凭证在 `$XDG_DATA_HOME/opencode/`。
- 模型值带 `provider/model` 前缀（`apply.modelPrefix = "osw/"`）。
- `apply.providerEntry` 用**模型名当键**（`models: { '{{model}}': {} }`），展开模板时键也要替换。
