# agent_clients

内置 Agent 客户端注册表。与 `../providers` 同构：**每个客户端一个目录**，目录里放
`agent.json`（描述 + 配置文件路径 + 字段 schema）和图标。

```text
agent_clients/
  index.ts                 # 自动扫描 + 排序 + 导出（不用手改）
  claude-code/
    agent.json
    icon.svg               # 或 icon.light.svg / icon.dark.svg
```

## 这份数据给谁用

给**备份与自动管理**用，不做任何文件 IO（本模块只描述形状）：

- `configDir` / `files[].path` —— 定位该工具的配置文件。
- `files[].format` —— 读写时用哪套解析/序列化。
- `files[].envVar` —— 该文件**目录**可被这个环境变量覆盖（`DSH_HOME`、`XDG_CONFIG_HOME`）。
- `fields[]` —— 该配置文件里需要识别/改写的键，即该工具的 schema 片段。

## 新增一个客户端

1. 建目录 `catalog/agent_clients/<key>/`（`<key>` 用 kebab-case，如 `claude-code`）。
2. 放 `agent.json`，字段见 `agent-clients.test.ts` 的断言：
   - 必填：`key` `name` `order` `description` `configDir` `files[]` `fields[]`
   - 可选：`aliases` `websiteUrl` `protocol`、`files[].envVar`
   - `configDir` 与 `files[].path` 一律以 `~/` 开头（`~` 由消费者展开为真实主目录）。
   - `order` 数值大的排前面，且各客户端之间必须唯一。
3. 放图标 `icon.svg`（自适应主题的单色图标）或 `icon.light.svg` / `icon.dark.svg`。
4. 跑 `pnpm test`、`pnpm typecheck`、`pnpm lint`。

`index.ts` 会自动扫描目录，**不需要**在代码里登记新客户端。

## 路径与字段的来源

`files` 与 `fields` 取自 [yetone/magpie](https://github.com/yetone/magpie) 各
`internal/agent/<client>.go` 的权威实现（它管理的正是同一批客户端），并经其
`internal/agent/legacy_test.go` 的真实配置样本核对。图标取自
<https://usemagpie.ai/>，来源清单见 `docs/design/agent-icons/README.md`。
