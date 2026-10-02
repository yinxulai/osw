# clients

内置 Agent 客户端注册表的**表示层**。定义本身（描述 + 配置文件路径 + 字段 schema）住在
`@common/clients`（`packages/contracts/source/clients.ts`：形状在 `clients/types.ts`，每个客户端
一个目录 `clients/<key>/`，内含 `definition.json` 与 icon）——管理服务端也要用它解析与校验
配置文件路径，而 core 不许依赖 console。这里只补**图标**：`import.meta.glob` 是打包器的能力，
契约包（Node 侧与 Worker 也在消费）用不了。

```text
packages/contracts/source/clients/
  clients.ts               # 静态汇总全部 definition.json + 查询/配方辅助函数
  types.ts                 # 形状
  claude-code/
    definition.json        # 定义（core 与 console 都读）
    icon.svg               # 或 icon.light.svg / icon.dark.svg
    README.md              # 官方文档与来源
clients/                   # 本目录：表示层
  index.ts                 # 按 key 把图标合并进定义 + 导出（不用手改）
```

## 这份数据给谁用

给**备份与自动管理**用（本模块只描述形状，不做任何文件 IO）：

- `configDir` / `files[].path` —— 定位该工具的配置文件。
- `files[].format` —— 读写时用哪套解析/序列化。
- `files[].shape` —— 文件内部的**存储形状**（缺省 `{ kind: 'map' }`，即一棵嵌套映射）。
  选择性地声明 `{ kind: 'patchList', idField, payloadField }` 表示「顶层是一串按 `id` 定位的
  条目、每条的配置藏在 `payloadField` 里」——如 DeepSeek Harness 的 `config.yaml`。这一层把
  「字段语义」（`fields[].path` 只写逻辑路径）与「存储格式」解耦：读取、创建、改写都由格式
  编辑器按 `shape` 解释，注册表不必知道文件里其实是补丁列表。
- `files[].envVar` —— `{ name, replaces }`：该文件**目录**可被这个环境变量覆盖，
  并写清它替换的是哪段 `~/` 前缀（`DSH_HOME` → `~/.dsh`、`XDG_CONFIG_HOME` → `~/.config`）。
- `fields[]` —— 该配置文件里需要识别/改写的键，即该工具的 schema 片段。

## 新增一个客户端

1. 在 `packages/contracts/source/clients/` 下新建 `<key>/` 目录（`<key>` 用 kebab-case，
   如 `claude-code`），放入：
   - `definition.json`：照抄现有客户端目录里那份的形状（字段见
     `packages/contracts/source/clients.test.ts` 的断言）。
     - 必填：`key` `name` `order` `description` `configDir` `files[]` `fields[]`
     - 可选：`aliases` `websiteUrl` `protocol`、`files[].envVar`、`files[].shape`、`files[].load`、`apply`
     - `configDir` 与 `files[].path` 一律以 `~/` 开头（`~` 由消费者展开为真实主目录）。
     - `order` 数值大的排前面，且各客户端之间必须唯一。能自动写入（有 `apply`）的客户端
       一律排在只能手改的之前——这是一条要守住的次序，不是权重碰巧。
     - `files[].load`：给「只能靠环境变量配置」的客户端用（如 Copilot CLI 的
       `COPILOT_PROVIDER_*`）。带这个标记的文件必须是 `format: "env"`，并由 OSW 维护、
       注入登录 shell 启动文件（Windows 走 PowerShell `$PROFILE`）——见
       `packages/core/source/client-config/shell.ts`。
   - 图标：自带品牌色的标志给一张 `icon.svg`（两套主题共用）；单色标志必须给 `icon.svg`
     （深色，亮色主题用）+ `icon.dark.svg`（浅色，暗色主题用）。这两份就是纯黑白两色，
     别指望 `fill="currentColor"` 跟着主题走。
   - `README.md`：记该客户端的官方文档与来源。
2. 在 `packages/contracts/source/clients.ts` 的 `AGENT_CLIENT_DEFINITIONS_UNSORTED` 里
   补一行 import + 一处引用：定义是**静态引入**的（契约包没有打包器来 glob），漏了就是真的没被登记。
3. 跑 `pnpm test`、`pnpm typecheck`、`pnpm lint`。

本目录的 `index.ts` 会自动扫描图标，**不需要**在代码里登记新客户端的图标。

## 路径与字段的来源

`files` 与 `fields` 按各客户端的官方文档整理（见每个目录下的 `README.md`）。图标取自
<https://usemagpie.ai/> 的 "EVERY AGENT" 区块，逐个对应关系：

| 客户端 | 原始 URL |
| --- | --- |
| `claude-code` | <https://usemagpie.ai/icons/claudecode-color.svg> |
| `codex` | <https://usemagpie.ai/icons/codex-color.svg> |
| `opencode` | <https://usemagpie.ai/icons/opencode.svg> |
| `pi` | <https://usemagpie.ai/icons/pi.svg> |
| `copilot-cli` | <https://usemagpie.ai/icons/githubcopilot.svg> |
| `deepseek-harness` | <https://usemagpie.ai/icons/deepseek-color.svg> |

`vscode` 不在这份名录里，用的是 VS Code 官方标志（品牌色 `#007ACC`）。

抓取时是逐字节拷贝，只规整了文件名，各 SVG 保持原本 `viewBox="0 0 24 24"`。
其中 `pi` / `opencode` / `copilot-cli` 用 `fill="currentColor"`，
其余自带品牌色。

⚠️ **`currentColor` 在 `client-icon.tsx` 的 `<img>` 里不会继承页面文字色**：
`<img>` 里的 SVG 是独立文档，没有可继承的 `color`，浏览器按初始值解析成**纯黑**。
亮色主题下正好，暗色主题下就是黑底黑图（实测这四个图标的像素恒为 `rgb(0,0,0)`）。
所以这三个客户端各带了一份 `icon.dark.svg`：几何逐字节相同，只把根节点的
`fill="currentColor"` 换成 `fill="#ffffff"`。想改单色图标的形状，两份要一起改。
（`opencode` 的图是方形外框、`pi` 是块状 P、`copilot-cli` 是幽灵剪影，
三个都是实心剪影，白底/黑底上都读得清。）
