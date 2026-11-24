# Codex

OpenAI 的终端编码 agent。

## 官方文档

- 配置参考（`model` / `model_provider` / `model_reasoning_effort` /
  `model_providers.<id>`）：
  <https://developers.openai.com/codex/config-reference>
- 仓库内同源说明：<https://github.com/openai/codex/blob/main/docs/config.md>
- 仓库：<https://github.com/openai/codex>

## 来源

`definition.json` 的路径与字段照官方配置参考整理。

## 要点

- 配置是 TOML；`apply.providerEntry` 写 `model_providers.<id>` 表项。
- 不写 `env_key`：本地服务不校验鉴权，而 `env_key` 一旦写了，Codex 会要求这个环境变量
  必须存在，等于凭空给用户加一个必须导出的变量。
- 写 `experimental_bearer_token`（那个固定的样例密钥，不是真凭据）：Codex 只在 provider
  带凭据时才会去拉模型目录，没有它 `model_catalog_url` 形同虚设。它和 `env_key` 的区别
  正是后者强加的那个环境变量——这里写的是字面量，不需要用户导出任何东西。
- 写 `model_catalog_url` 指向本机服务的 `/v1/model-catalog`（Codex ≥ 0.172）：不写的话，
  `/model` 选择器里只有 Codex 自带的模型，osw 的逻辑模型一个都不出现。
