# Claude Code

Anthropic 的终端编码 agent。

## 官方文档

- 设置（`env` 块、`ANTHROPIC_*` 键、`CLAUDE_CONFIG_DIR`）：
  <https://code.claude.com/docs/en/settings>
- 产品页：<https://www.anthropic.com/claude-code>

## 来源

`definition.json` 的路径与字段照官方设置页整理。

## 要点

- `apply.providerEntry`：无。地址与 token 直接写在 `env` 块里，没有单独的 provider 表。
- 五个模型别名（`opus` / `sonnet` / `haiku` / `fable` / `smallFast`）连同各自的
  `*_MODEL_NAME` 展示名必须**一起**改写：base URL 已经指向本地了，别名再解析到真实
  Anthropic 的模型名就会绕过路由。
