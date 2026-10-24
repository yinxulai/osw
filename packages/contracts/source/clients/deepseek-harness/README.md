# DeepSeek Harness

`dsh`（DeepSeek Harness）。

## 官方文档

- 仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 配置总览（profile、补丁层、`settings.yaml`）：`docs/user/guide/`
- Provider / 模型配置：`docs/user/guide/providers.md`
- `llm-pi-ai` 适配器（自定义 route 的字段全集）：`packages/llm/llm-pi-ai/README.md`

## 要点

- **可写面是 `$DSH_HOME/settings.yaml`**：这是一棵普通嵌套映射，harness 会**热加载**它——
  运行时改变下一轮请求就生效，不必重启。两类内容都在这里：新会话的默认模型
  `agent-default-model`（`{ provider, model }`），以及手写的 provider route
  `llm-pi-ai.providers.<route>`。
- **provider route 的形状**：`{ displayName, api, baseURL, models, headers }`。`api` 用
  `openai-completions`，`baseURL` 指向本机服务的 `/v1`，`models` 是 `{ id }` 组成的**数组**。
- **模型必须自己声明推理档位**：内置 provider 的模型从内置目录继承档位，而**手写的模型一个都不声明**。
  结果是两件事同时发生：模型选择菜单里不出现 Effort 一项；会话一旦带着档位请求（用户选过、或从
  `agent-default-model.reasoningEffort` 继承下来）就会被拒为
  `UNSUPPORTED_REASONING_EFFORT`——`provider "osw" model "default" does not support reasoning effort "high"`
  就是这条。harness **不做钳位也不做别名**，所以只能在配方里用 `reasoningEfforts` 把档位显式接上：
  每个键是菜单提供的一档，值是这一档发到线上的拼写（`reasoning_effort` 的值）；只有 `off` 可以是空值，
  含义是「这一档支持、但请求里什么都不发」，把思考与否交还给端点自己的默认行为。
- **为什么要写一个 `Authorization` 头**：pi-ai 的 OpenAI 兼容实现即使面对不校验密钥的本地服务，
  也要求带上一个凭证——官方说明里这是「无凭证 route 需要占位凭证」的两种写法之一（另一种是
  `apiKeyEnv`）。直接写 `headers.Authorization` 比 `apiKeyEnv` 少一份间接引用：本机服务本就不
  校验这个密钥，也就不必再让用户在环境里维护一个变量。
- **`config.yaml` 是历史遗留层**：较早版本用它承载整机补丁（一串 `{ id, config }`，按 `id`
  整段覆盖）。较新的 dsh 把用户配置拆成 profile 补丁层（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）
  叠加在 bundle 之上，运行期要改的东西落在 `settings.yaml`。本条目把 `config.yaml` 声明为
  `patchList` 形状以便**读**，写入不碰它（配方只指向 `settings.yaml`）。
- **`DSH_HOME`**：声明该目录可被这个环境变量改道，默认 `~/.dsh`。
- 该工具是 developer preview，配置结构仍在演进。
