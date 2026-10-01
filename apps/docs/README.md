# 文档根

`apps/docs/` 是仓库的**文档根**。里面的东西按**去向**分成四类，彼此的读者、生命周期和发布方式都不同，**不互相复制**：

| 目录 | 类别 | 面向 | 发布去向 |
|------|------|------|---------|
| [`source/`](./source/) | 开放文档（使用手册，按语言分目录） | 使用者 | 构建成静态站，发布到 Cloudflare Workers（Static Assets） |
| [`specs/`](./specs/README.md) | 产品规格（内部） | 维护者 | 只在仓库里，服务实现与评审，不进站点 |
| [`upstream/`](./upstream/README.md) | 上游协议参考（逐字快照） | 实现者 | 只在仓库里，是协议转换的字段依据 |
| [`assets/`](./assets/README.md) | 设计文档与视觉资产 | 视觉 / 物料 | 只在仓库里，不参与构建，也不进打包 |

一句话概括四者的分工：

- **`source/` 讲「怎么用」**，只回答使用者的问题，是唯一会被发布出去的内容。
- **`specs/` 讲「我们决定怎么做」**，是本仓库自己的设计结论（产品规格、行为契约、验收标准）。
- **`upstream/` 讲「上游到底怎么定义的」**，是厂商公开 API 文档的逐字快照，只服务协议转换的字段映射。
- **`assets/` 收设计与物料**，品牌标志的单一矢量源、导出规则、社交封面等。

目录名刻意取短、取中性：`specs/` / `upstream/` / `assets/` 各自本身就是一句名词定义，出现在路径里（`apps/docs/specs/proxy.md`）时不用再解释它属于哪一类。

## 布局原则

1. **按去向分类，不按主题分类。** 一个主题（比如「故障转移」）可以在 `source/` 和使用者对话、在 `specs/` 定义行为契约、在 `upstream/` 找到上游字段依据——三处说的是同一件事的不同侧面，但**它们属于不同的发布去向**，所以放在不同目录，而不是按主题摊在一起。判断一份内容的归属，先问「它给谁看、会不会被发布」，而不是「它讲什么」。
2. **一个主题只有一处权威。** 跨类提到同一主题时只写一句结论加链接，不展开复述。`specs/` 内部同样如此——[`specs/README.md`](./specs/README.md) 的文档地图是各主题权威文档的唯一索引。发现两处描述不一致时，以权威文档和代码为准。
3. **开放文档只服务使用者。** 内部实现取舍、未定稿的设计、维护者才关心的边界，一律不进 `source/`；使用者不需要的细节留在 `specs/`。
4. **每个子树自带索引。** 具体约定（`specs/` 的文档地图、`upstream/` 的检索约定、`assets/` 的资产清单）写在各自的 `README.md` 里，本文件只负责「有哪些类、各自去哪」，不重复各子树的内部结构。
5. **文件与 URL 同名。** 开放文档的文件名就是站点路径（`source/zh/upstreams/routing.mdx` → `/upstreams/routing`），产品文档用相同的英文 slug（`specs/provider-model.md`），这样「文档名 ↔ 站点页 ↔ 代码注释里的引用」三处一致，检索时不必记忆别名。带语言前缀的 URL 与文件名同构（`source/en/upstreams/routing.mdx` → `/en/upstreams/routing`），两种语言的同名页共享段 slug。

> **为什么不把三类内部内容都塞进一个目录？** 它们看起来都是「非站点文档」，但生命周期不同：`specs/` 随产品演进反复改写，`upstream/` 是逐字快照、只增不改，`assets/` 是二进制与画布物料、由脚本重写。混在一个目录里，就得靠文件名前缀来区分这几种完全不同的维护规则；分成三个目录，规则各自成文，也不用为「这份 md 该不该进打包」逐个判断。

## 开放文档（站点）

`source/<locale>/` 下的 MDX 由 [Clarify](https://github.com/taicode-labs/clarify) 构建为静态站。站点结构（有哪些页、怎么分组）声明在 [`clarify.ts`](./clarify.ts)，正文在各 `.mdx` 里。

站点按读者的阶段分**四个 tab**——开始使用、上游与路由、观测与数据、参考——每个 tab 回答一个问题，而不是把全部页面塞进一个「使用指南」。为什么这么分、每个 tab 下有哪些组，都写在 `clarify.ts` 的注释里（它是导航结构的唯一事实来源，本文件不重复）。

```bash
pnpm --filter @osw/docs dev      # 本地开发服务器
pnpm --filter @osw/docs build    # 构建静态产物到 output/
pnpm --filter @osw/docs preview  # 预览构建产物
```

## 多语言

**中文是主要维护语言**（`locales.default = 'zh'`）：它占据根路径（`/getting-started/installation`），是内容的权威版本；英文挂在 `/en` 前缀下（`/en/getting-started/installation`）。两种语言都同时可按语言前缀访问（`/zh/getting-started/installation` 亦有效），因此带前缀的链接永远稳定。

配置在 [`clarify.ts`](./clarify.ts) 的 `locales`（`default` / `missing` / `locales`）；正文按语言分目录，目录内再按 tab 分子目录，两边文件与 slug 一一对应：

```text
source/
├── zh/                          # 默认语言（主要维护语言）
│   ├── index.mdx                # → /
│   ├── getting-started/         # → /getting-started/installation
│   ├── upstreams/               # → /upstreams/routing
│   ├── observability/           # → /observability/request-logs
│   └── reference/               # → /reference/settings
└── en/                          # 同构，挂在 /en 前缀下
```

`missing: 'fallback'` 是这里的关键选择：**英文缺哪一页，该页就自动回退到中文，而不是 404**。这让英文可以**增量补译**，站点任何时刻都不会出现断页。构建时 `clarify check` 会对每个待补译的页报一条 `i18n-fallback-route` warning——那是**已知且预期**的，不是错误；译完之后 warning 自然消失（当前已全部译完，无 warning）。

导航、页脚、tab / 分组 / 页标题在 `clarify.ts` 里都写成 `{ zh, en }` 双语（页面正文里的**站内链接**用无前缀的裸路径，如 `/protocols`，由当前语言自动解析到正确版本）；站点级 `title` / `description` 仍是单值字符串，即默认语言。SEO 上：`siteUrl` 会生成双语言的 `sitemap.xml` 与 `robots.txt`，默认语言的裸路径页会输出 `canonical` 指向带前缀的规范 URL（`/quick-start` → `/zh/quick-start`）去重。

### 译制进度

四个 tab 的**中英双语已全部译完**，无回退页。要补或改某一页，就是在 `source/en/<tab-dir>/<slug>.mdx` 新建 / 修改同名文件（可直接从 `source/zh/<tab-dir>/<slug>.mdx` 复制再翻译，保持 `title` / `description` / 段结构与中文一致）。

| Tab | 目录 | English |
| --- | --- | --- |
| 开始使用 | `getting-started/` | ✅ 已译 |
| 上游与路由 | `upstreams/` | ✅ 已译 |
| 观测与数据 | `observability/` | ✅ 已译 |
| 参考 | `reference/` | ✅ 已译 |

> **改中文时同步看英文。** 中文是权威版本，改动了中文页的 slug、段结构或站内链接时，`source/en/` 下同页也要跟着改；不确定英文是否跟得上时，宁可先把该英文页删掉，让 fallback 接住，也不要留下与中文不一致的译文。
>
> **`description` 里含 `: `（冒号加空格）时必须整体加引号。** YAML 会把它当成键值分隔符，导致 `clarify check` / `build` 直接抛 `YAMLException` 而中断。`title` 同理。

## 部署（Cloudflare Workers）

站点是**纯静态**产物，由 **Cloudflare 侧的 Workers Git 集成**直连本仓库发布——**不走 GitHub Actions**，仓库里也不放部署流水线。push 到生产分支即构建 + 部署。

在 Cloudflare 后台（Workers & Pages → 本项目 → Settings → Build）填：

| 项 | 值 |
| --- | --- |
| Git 仓库 / 生产分支 | `yinxulai/osw` · `main` |
| Root directory | `apps/docs` |
| Build command | `pnpm install && pnpm build` |
| Deploy command | `npx wrangler deploy` |

要点与坑：

- **项目形状：这是一个 Worker，不是 Pages 项目。** 后台路径形如 `/workers/services/view/osw-docs`，GitHub 上对应的 check 名是 `Workers Builds: osw-docs`。这一点决定了仓库配置必须写成 **Workers Static Assets** 形状（`[assets] directory`），部署命令是 Workers 的 `npx wrangler deploy`，而不是 Pages 的 `npx wrangler pages deploy`。
- **别用 Pages 形状。** 如果写成 Pages 的 `pages_build_output_dir`，`npx wrangler deploy` 会看不出「产物目录」，报 `✘ Missing entry-point to Worker script or to assets directory`——**构建是成功的，只有部署这一步失败**，且报错出现在 deploy 阶段，很容易误判成缓存或没保存。**判断形状看部署命令**：用 `wrangler deploy` 就是 Workers 形状（配 `[assets]`），用 `wrangler pages deploy` 才是 Pages 形状（配 `pages_build_output_dir`）。
- **`wrangler.toml` 就在仓库里**（[`apps/docs/wrangler.toml`](./wrangler.toml)），Git 集成会直接用它：只有 `name`、`compatibility_date`、`routes` 和 `[assets]`，因为站点没有 Worker 脚本、没有绑定、没有密钥。它同时是项目配置的**唯一事实来源**。
- **包管理器**：`pnpm-lock.yaml` 在仓库根，Root directory 指向子目录时 Cloudflare 未必能自动识别。在 Build 的 **Variables and secrets** 里加一条 `PNPM_VERSION`（与仓库根 `package.json` 的 `packageManager` 同版）最稳。
- **自定义域名**：本文件用 `routes = [{ pattern = "docs.osw.yinxulai.com", custom_domain = true }]`，`npx wrangler deploy` 会顺带创建 DNS 记录并申请证书（前提是 `yinxulai.com` 这个 zone 在同一个 Cloudflare 账号下）。
- **产物形态**：Clarify 生成的是逐页静态 HTML（`output/<slug>/index.html`）、Pagefind 全文搜索索引、每页的 `.md` 孪生文件与 `llms.txt`。它是**多页站**，不是 SPA，因此 `not_found_handling` 用 `404-page` 而不是 `single-page-application`。

本地想手动部署一次：`pnpm --filter @osw/docs deploy`（需先 `wrangler login` 或配 `CLOUDFLARE_API_TOKEN`）；想只校验配置不真正上传：`pnpm --filter @osw/docs deploy:dry-run`。

> 仓库里另有 `apps/www`（官网）与 `apps/apis`（匿名统计端点）两个 Worker。文档站与它们一样走 **Cloudflare Workers Static Assets**：纯静态站在两种托管下能力没有差别，而 Workers 的配置能把「产物目录」和「自定义域名」都写进仓库，不需要像 Pages 那样去后台手动绑域名——所以三个站点用同一种部署形状，规则只有一套。
