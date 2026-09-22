# apps/www — 产品官网

logo、名字、功能与下载入口的纯净态落地页。**Vite + React + TypeScript + Tailwind v4**，
构建为纯静态产物（`output/`），由 **Cloudflare Workers Static Assets** 托管。

## 技术栈（为什么这么选）

- **Vite + React + TS + Tailwind v4**：与 `packages/console` 完全同栈，直接复用设计 token、
  logo（`public/icon.svg`）与「不用阴影、发丝边框分模块」的视觉约定，不引入新框架。
  明确不用 Next.js：这是无 SSR 需求的静态落地页，Vite 产物更简单、更快、更小。
- **部署 = Workers Static Assets，且只有静态资源**：`wrangler.toml` 里没有 `main`，
  也就没有 Worker 脚本——下载按钮是前端直接跳 GitHub Releases 的外部链接，服务端不需要逻辑。
  纯静态「纯净态」托管，构建与部署交给 Cloudflare 侧的 Workers Git 集成，仓库里不放部署流水线。

## 本地

```bash
pnpm --filter @osw/www dev        # Vite dev server（端口 5174）
pnpm --filter @osw/www build      # 构建静态产物到 output/
pnpm --filter @osw/www preview    # 本地预览构建产物
pnpm --filter @osw/www deploy:dry-run   # wrangler 干跑（校验 assets 配置）
pnpm --filter @osw/www dev:worker # 本地起静态资源服务（wrangler dev）
```

## 多语言（i18next）

用 **i18next + react-i18next**，但**中文不建资源表**：中文是兜底语言，文案直接写在
`t(key, '中文')` 的第二个参数里（就写在用到它的那个组件里），英文才在 `source/i18n.ts` 里有一份资源表。

```tsx
const { t, i18n } = useTranslation()
t('downloads.title', '下载')                       // en 表里没有就回落到 '下载'
t('downloads.version', '当前版本 · v{{version}}', { version })  // 插值
i18n.changeLanguage('zh')                          // 切语言（组件自动重渲）
```

好处是**永远不会漏翻译**：新增文案时先在 JSX 里写中文兜底，英文表漏了就显示中文，而不是显示 key。
初始化语言按 `navigator.language` 猜（`zh*` → 中文），识别不到也是中文；`<html lang>` 跟随界面语言。

加文案的流程：在对应组件的 JSX 里写 `t('<域>.<叶子>', '中文')`，需要英文时再去 `i18n.ts` 的 `en`
对象补同名 key（用嵌套对象）。

> ⚠️ key 里**不要出现点号以外的分隔**，也别把整条 key 写成 `'footer.repo'` 再指望它是**字面** key——
i18next 会把点号解析成嵌套路径，找不到就回落。顶层单段 key（如 `footerRepo`）最省事。

> 注意：`apps/www` 不在根 `eslint.config.js` 的 `i18n/no-hardcoded-cjk` 规则范围内
> （那段只覆盖 `apps/app`、`apps/cli`、`packages/*`），所以这里内联中文不会被 lint 拦。

## 部署（Cloudflare Workers · Git 集成）

**不走 GitHub Actions。** 由 Cloudflare 侧的 **Workers Builds** 直连本仓库：push 到生产分支即构建 + 部署
（Dashboard → Workers & Pages → 本项目 → Settings → Build）。

在 Cloudflare 项目里填：

| 项 | 值 |
| --- | --- |
| Git 仓库 / 生产分支 | `yinxulai/osw` · `main` |
| Root directory | `apps/www` |
| Build command | `pnpm install && pnpm build` |
| Deploy command | `npx wrangler deploy` |
| Version command（非生产分支） | `npx wrangler versions upload` |

> Build / Deploy / Version 三条命令的**工作目录就是 Root directory**（`apps/www`），
> 所以不需要 `--config`、也不需要 `cd`。Deploy 命令用于生产分支：直接、永久地发布。
> Version 命令用于预览分支：只上传一个版本，不接收流量、不动生产。二者只能填其一为空，
> 否则每次 push 都会同时发一次线上。
> `wrangler` 不进 `dependencies`，用 `npx` 临时取一份即可（npx 会优先用仓库里已有的）。

要点与坑：

- **包管理器**：`pnpm-lock.yaml` 在仓库根，而 Root directory 指向子目录时 Cloudflare 未必能自动识别。
  在 Build 的 **Variables and secrets** 里加 `PNPM_VERSION`（与仓库根 `packageManager` 同版）最稳。
- **wrangler.toml 就在仓库里**（`apps/www/wrangler.toml`），Git 集成会直接用它——只有 `[assets]`
  一张表，没有 `main`、没有绑定，无需在 Dashboard 里重复配任何东西。
- **自定义域名**：`wrangler.toml` 的 `routes` 已声明绑定。前提是该 zone 在同一账号下；否则删掉 `routes`，
  改到 Workers → Settings → Domains & Routes 手动绑定。

本地想手动部署一次：`pnpm --filter @osw/www deploy`（需先 `wrangler login` 或配 `CLOUDFLARE_API_TOKEN`）。

## 下载（一个按钮，跳 GitHub Releases）

站点**不做**按平台分发，也**不**代理安装包：下载区只有一个公共按钮，指向

```text
https://github.com/yinxulai/osw/releases/latest
```

（`source/downloads.ts` 的 `RELEASE_URL`）。这是 GitHub 的「最新发布」永久地址，自动指向最新一个
正式发布——所以站点**不需要跟着发版更新任何东西**，也不会出现「页面上的固定路径 404」。
按钮上方那一行平台标记（macOS / Windows / Linux）只是「支持哪些平台」的说明，不可点。

按钮下面显示的版本号来自仓库根 `package.json` 的 `version`（构建期注入，见 `vite.config.ts`），
**只用于展示**，与跳转目标无关；它跟着站点构建时间走，站点没重新部署时可能落后于最新发布。

安装包本身由 release 工作流产出（命名见 `apps/app/electron-builder.config.cjs` 的 `artifactName`，
形如 `OSW-<version>-<os>-<arch>.<ext>`），由发布流程上传到 GitHub Releases。

> 将来若要做「站内直接下载、不跳 GitHub」：加回 `main` 与 R2 绑定，在 Worker 里按平台从桶里
> 取最新对象并流式返回，桶空时再 302 到 GitHub。这一版刻意不做——先用最少的活动部件把链接跑通。

### 校验

```bash
curl -I https://osw.yinxulai.com/    # 200，HTML
```

## 目录

```text
apps/www/
  source/            # React 应用
    App.tsx          # 页面骨架：背景层 + 区块顺序（各节实现在 components/ 下）
    components/      # 逐节拆分的区块
      site-header.tsx        # 常驻顶栏（锚点导航 + 语言开关 + 下载按钮）
      hero.tsx               # 首屏：承诺 + 两个动作 + 右侧轨迹
      request-trace.tsx      # 首屏右侧的「请求轨迹」动效（产品主视觉）
      failover-section.tsx   # 故障转移判定口径表
      capabilities-section.tsx # 路由改写 / 可观测 / 协议识别
      screenshots-section.tsx # 界面预览（直接用 snapshot/ 里的真实截图）
      privacy-section.tsx    # 四条隐私承诺（第四条是匿名统计）
      download-section.tsx   # 下载区（全站唯一主行动区）
      site-footer.tsx        # 页脚
      section-heading.tsx    # 区块标题组（小标签 + 标题 + 引言）
      reveal.tsx             # 滚动进场包装（IntersectionObserver）
    i18n.ts          # i18next 初始化 + 英文资源表（中文是兜底语言，见下）
    downloads.ts     # 版本号 + 最新发布页地址
    platforms.ts     # 平台清单（下载区那一行平台标记用）
    screenshots.ts   # 界面预览的图清单（外部 import snapshot/，不做副本）
    platform-icons.tsx # 三平台品牌标记（Simple Icons + 手绘 Windows 方标）
    feature-icons.tsx  # 能力图标（手绘 1.5px 描边，继承 currentColor）
    index.css        # Tailwind v4 入口 + 设计 token + 基础样式
    main.tsx / vite-env.d.ts
  public/
    icon.svg           # 官方 logo（自 packages/console/public/icon.svg 复制的副本；改 logo 以真源为准同步覆盖）
    social-preview.png # 分享卡片图（自 docs/design/brand/png/ 复制）
  wrangler.toml      # Workers Static Assets（纯静态，无 main、无绑定）
  vite.config.ts / tsconfig.json / index.html
```

## 视觉约定

沿用 `docs/product/route-workbench.md` 的视觉下限：**不用阴影**，层级靠「底色明度阶梯 + 1px 发丝边框」表达，
字号下限 11px。具体到官网，多放开两件事：

- **品牌渐变**：标志是一道彩虹斜切的闪电，`index.css` 把它的四个色相（金 → 橙 → 玫红 → 紫）取出来做点缀，
  只出现在焦点处——首屏标题的关键词、下载区的光晕、卡片 hover 时的图标。正文与结构仍然是中性的。
- **设计 token**：底色、边框、文字、品牌色、状态色全部收敛在 `index.css` 的 `@theme` 里，组件只用
  `bg-surface-1` / `text-ink-3` / `border-line` / `text-brand` 这类语义类名，不再在 className 里写死色值。

`index.css` 另提供三个工具类：`.brand-gradient`（渐变文字）、`.bg-grid`（顶部网格底纹）、
`.ring-gradient`（1px 渐变描边，替代 `border` 做卡片边缘）。滚动进场用 `[data-reveal]` + `Reveal` 组件，
**默认可见**，JS 接管后才从下方浮入——JS 没跑起来时不会白屏。

> 首屏的产品主视觉是**用 CSS 画的请求轨迹**，不是产品截图。原因：「渠道失败后发生了什么」
> 这件事本身更适合画成一条有先后顺序的链，而不是贴一张静态图。
>
> 但网站上另有**一节专门的「界面预览」**（`screenshots-section.tsx`），让用户下载之前
> 就知道界面是什么密度、什么色调。那一节**直接 `import` 仓库根的 `snapshot/*.png`**，不在
> `public/` 里再摆一份副本——README 与官网共用同一个图源，改图只需改一处，Vite 构建时会
> 自己把它们哈希进 `output/assets/`。顺带一个已知取舍：这批截图拍于图标改版之前，侧边栏还是
> 旧版青色标志，与当前品牌不一致，但内容仍是真实界面，所以保留原图而不是重画。
