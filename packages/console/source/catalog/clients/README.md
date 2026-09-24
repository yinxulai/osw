# clients

内置 Agent 客户端注册表的**表示层**。定义本身（描述 + 配置文件路径 + 字段 schema）住在
`@common/clients`（`packages/contracts/source/clients.ts`）——管理服务端也要用它解析与校验
配置文件路径，而 core 不许依赖 console。这里只放**图标**：`import.meta.glob` 是打包器的能力，
契约包（Node 侧与 Worker 也在消费）用不了。

```text
clients/
  index.ts                 # 把契约定义与图标合并 + 导出（不用手改）
  claude-code/
    icon.svg               # 或 icon.light.svg / icon.dark.svg
```

## 这份数据给谁用

给**备份与自动管理**用（本模块只描述形状，不做任何文件 IO）：

- `configDir` / `files[].path` —— 定位该工具的配置文件。
- `files[].format` —— 读写时用哪套解析/序列化。
- `files[].envVar` —— `{ name, replaces }`：该文件**目录**可被这个环境变量覆盖，
  并写清它替换的是哪段 `~/` 前缀（`DSH_HOME` → `~/.dsh`、`XDG_CONFIG_HOME` → `~/.config`）。
- `fields[]` —— 该配置文件里需要识别/改写的键，即该工具的 schema 片段。

## 新增一个客户端

1. 在 `packages/contracts/source/clients.ts` 的 `AGENT_CLIENT_DEFINITIONS_UNSORTED` 里加一条定义，
   字段见 `packages/contracts/source/clients.test.ts` 的断言：
   - 必填：`key` `name` `order` `description` `configDir` `files[]` `fields[]`
   - 可选：`aliases` `websiteUrl` `protocol`、`files[].envVar`
   - `configDir` 与 `files[].path` 一律以 `~/` 开头（`~` 由消费者展开为真实主目录）。
   - `order` 数值大的排前面，且各客户端之间必须唯一。
2. 建目录 `catalog/clients/<key>/`（`<key>` 用 kebab-case，如 `claude-code`），放图标
   `icon.svg`（自适应主题的单色图标）或 `icon.light.svg` / `icon.dark.svg`。
3. 跑 `pnpm test`、`pnpm typecheck`、`pnpm lint`。

`index.ts` 会自动扫描目录，**不需要**在代码里登记新客户端。

## 路径与字段的来源

`files` 与 `fields` 取自 [yetone/magpie](https://github.com/yetone/magpie) 各
`internal/agent/<client>.go` 的权威实现（它管理的正是同一批客户端），并经其
`internal/agent/legacy_test.go` 的真实配置样本核对。图标取自
<https://usemagpie.ai/> 的 "EVERY AGENT" 区块，逐个对应关系：

| 客户端 | 原始 URL |
| --- | --- |
| `claude-code` | <https://usemagpie.ai/icons/claudecode-color.svg> |
| `codex` | <https://usemagpie.ai/icons/codex-color.svg> |
| `gemini-cli` | <https://usemagpie.ai/icons/geminicli-color.svg> |
| `opencode` | <https://usemagpie.ai/icons/opencode.svg> |
| `pi` | <https://usemagpie.ai/icons/pi.svg> |
| `cursor-cli` | <https://usemagpie.ai/icons/cursor.svg> |
| `copilot-cli` | <https://usemagpie.ai/icons/githubcopilot.svg> |
| `deepseek-harness` | <https://usemagpie.ai/icons/deepseek-color.svg> |

抓取时是逐字节拷贝，只规整了文件名，各 SVG 保持原本 `viewBox="0 0 24 24"`。
其中 `pi` / `opencode` / `cursor-cli` / `copilot-cli` 用 `fill="currentColor"` 继承前景色，
其余自带品牌色；本仓库的 `icon.svg` 是它们的主题自适应单色化版本。
