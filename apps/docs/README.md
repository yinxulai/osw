# 文档根

`apps/docs/` 是仓库的**文档根**。里面的东西按**去向**分成四类，彼此的读者、生命周期和发布方式都不同，**不互相复制**：

| 目录 | 类别 | 面向 | 发布去向 |
|------|------|------|---------|
| [`source/`](./source/) | 开放文档（使用手册） | 使用者 | 构建成静态站，发布到 Cloudflare Pages |
| [`product/`](./product/README.md) | 产品规格（内部） | 维护者 | 只在仓库里，服务实现与评审，不进站点 |
| [`references/`](./references/README.md) | 上游协议参考（逐字快照） | 实现者 | 只在仓库里，是协议转换的字段依据 |
| [`design/`](./design/README.md) | 设计文档与资产 | 视觉 / 物料 | 只在仓库里，不参与构建，也不进打包 |

一句话概括四者的分工：

- **`source/` 讲「怎么用」**，只回答使用者的问题，是唯一会被发布出去的内容。
- **`product/` 讲「我们决定怎么做」**，是本仓库自己的设计结论（产品规格、行为契约、验收标准）。
- **`references/` 讲「上游到底怎么定义的」**，是厂商公开 API 文档的逐字快照，只服务协议转换的字段映射。
- **`design/` 收设计与物料**，品牌标志的单一矢量源、导出规则、社交封面等。

## 布局原则

1. **按去向分类，不按主题分类。** 一个主题（比如「故障转移」）可以在 `source/` 和使用者对话、在 `product/` 定义行为契约、在 `references/` 找到上游字段依据——三处说的是同一件事的不同侧面，但**它们属于不同的发布去向**，所以放在不同目录，而不是按主题摊在一起。判断一份内容的归属，先问「它给谁看、会不会被发布」，而不是「它讲什么」。
2. **一个主题只有一处权威。** 跨类提到同一主题时只写一句结论加链接，不展开复述。`product/` 内部同样如此——[`product/README.md`](./product/README.md) 的文档地图是各主题权威文档的唯一索引。发现两处描述不一致时，以权威文档和代码为准。
3. **开放文档只服务使用者。** 内部实现取舍、未定稿的设计、维护者才关心的边界，一律不进 `source/`；使用者不需要的细节留在 `product/`。
4. **每个子树自带索引。** 具体约定（`product/` 的文档地图、`references/` 的检索约定、`design/` 的资产清单）写在各自的 `README.md` 里，本文件只负责「有哪些类、各自去哪」，不重复各子树的内部结构。
5. **文件与 URL 同名。** 开放文档的文件名就是站点路径（`source/logical-models.mdx` → `/logical-models`），产品文档用相同的英文 slug（`product/provider-model.md`），这样「文档名 ↔ 站点页 ↔ 代码注释里的引用」三处一致，检索时不必记忆别名。

> **为什么 `product/` 和 `references/` 不折腾目录？** 代码与单测注释里有上百处按 `apps/docs/product/<file>.md §N` 和 `apps/docs/references/<file>.md` 引用这两个子树，`apps/app/scripts/generate-icons.mjs` 与 `design/x-post/x-cover.html` 也各自写死了指向 `design/` 的相对路径。把它们整棵树挪走，等于同时改这些**所有**引用点，收益（目录更好看）远小于代价（一个迟早会漏改的全局重命名）。所以这里只规整**分类、索引与导航**，让布局可读、可发现；文件路径保持稳定，是刻意的取舍，不是疏忽。

## 开放文档（站点）

`source/` 下的 MDX 由 [Clarify](https://github.com/taicode-labs/clarify) 构建为静态站。站点结构（有哪些页、怎么分组）声明在 [`clarify.ts`](./clarify.ts)，正文在各 `.mdx` 里。

```bash
pnpm --filter @osw/docs dev      # 本地开发服务器
pnpm --filter @osw/docs build    # 构建静态产物到 output/
pnpm --filter @osw/docs preview  # 预览构建产物
```

## 部署（Cloudflare Pages）

站点是**纯静态**产物，由 **Cloudflare Pages 的 Git 集成**直连本仓库发布——**不走 GitHub Actions**，仓库里也不放部署流水线。push 到生产分支即构建 + 部署。

在 Cloudflare 后台（Workers & Pages → 本项目 → Settings → Build）填：

| 项 | 值 |
| --- | --- |
| Git 仓库 / 生产分支 | `yinxulai/osw` · `main` |
| Root directory | `apps/docs` |
| Build command | `pnpm install && pnpm build` |
| Build output directory | `output` |

要点与坑：

- **`wrangler.toml` 就在仓库里**（[`apps/docs/wrangler.toml`](./wrangler.toml)），Git 集成会直接用它：只有 `name`、`pages_build_output_dir`、`compatibility_date` 三个键，因为站点没有 Worker、没有绑定、没有密钥。它同时是 Pages 项目配置的**唯一事实来源**——同名项在后台会变成只读。
- **包管理器**：`pnpm-lock.yaml` 在仓库根，Root directory 指向子目录时 Cloudflare 未必能自动识别。在 Build 的 **Variables and secrets** 里加一条 `PNPM_VERSION`（与仓库根 `package.json` 的 `packageManager` 同版）最稳。
- **自定义域名**：Pages 的 Wrangler 配置**不认** `routes`（那是 Workers 的键），所以域名只能在后台 Custom domains 里手动绑定，例如 `docs.osw.yinxulai.com`。前提是该 zone 在同一个 Cloudflare 账号下。
- **产物形态**：Clarify 生成的是逐页静态 HTML（`output/<slug>/index.html`）、Pagefind 全文搜索索引、每页的 `.md` 孪生文件与 `llms.txt`。它是**多页站**，不是 SPA，因此不需要 `_redirects` 的 SPA 回退。

本地想手动部署一次：`pnpm --filter @osw/docs deploy`（需先 `wrangler login` 或配 `CLOUDFLARE_API_TOKEN`）。

> 仓库里另有 `apps/www`（官网）与 `apps/apis`（匿名统计端点）两个 Worker，它们走 **Cloudflare Workers Static Assets / Workers**。文档站选用 Pages，是遵从「用 Cloudflare Pages 部署」的明确意图：这个纯静态站在两种托管下能力没有差别，而 Pages 的 Git 集成对「一个仓库里挂多个站点」更直白（每个站点一个项目、Root directory 各自指向子目录）。这不构成对那两个 Worker 的迁移要求。
