# 设计系统落地差异审计（渲染后实测）

> 审计对象：本仓库 `audit/design-diff` 分支 @ `e3d632e9`（= 远端 `main`）的**实现**。
> 对照标准：设计系统规范 12 份（见 §1.2）。
> 这是一份**差异审计**，不是修复 PR：**没有改动任何产品代码**（见 §5）。
> 所有数字都来自本轮真机运行 + CDP 量测，出处写在每个数字旁边；测不到的写在 §6。

---

## 1. 范围

### 1.1 做了什么

- 真的把 console 跑起来（`vite` dev server，端口 5173），用 **CDP 量测**而不是只看截图：
  取计算样式、按 WCAG 公式算相对亮度比、量盒子与**有效命中区**、发真实指针与键盘事件。
- 覆盖 **11 个路由 + 1 个独立 HTML 入口（tray 面板）+ 5 个浮层** × **明/暗两套** = **34 次运行**：
  `overview`、`overview/prov_openai`、`router`、`logical-models`、`model-management`、`request-logs`、
  `request-rewrite-rules`、`client-config`、`logs`、`runtime-settings`、`onboarding`；
  浮层：供应商新建弹窗、重写规则下拉菜单、供应商模型筛选下拉、请求详情抽屉、生成账单弹窗。
- 另加 **14 次粗指针运行**（390×844、`pointer: coarse`、24px 阈值）
  与 **20 次 44px 阈值运行**（AAA 登记用）= 合计 **68 次 CDP 运行**（不含过程中被推翻作废的那些）。
- 每个页面在**两套主题**下都截了图：**50 张**被本文引用。它们先落在
  `/home/openclaw/.openclaw/workspace/state/design-review/`（题面要求的位置），
  再**原样复制**一份到 `apps/docs/specs/assets/design-system-audit/`。
  报告里出现的**所有图片文件名，都是相对 `apps/docs/specs/assets/design-system-audit/` 的**
  （本仓库内的那份）——`state/design-review/` 不在仓库里，PR 里点不开，所以不做相对引用。
  这 50 张 = **34** 张主矩阵（11 个路由 + tray + 5 个浮层，各明暗一次）
  + **14** 张粗指针（`-coarse-aa24`，7 个页面 × 明暗）+ **2** 张 hover 证据。
  （另有 6 张按 44px 阈值跑的 `-coarse.png` 没有收录——它们的尺寸结论已被 §3.7 的命中区量测取代。）

### 1.2 对照标准的来源（重要）

规范 12 份（`design-system.md` + 10 份分册 + `design-token-mapping.md`）**不在本分支上**：

```
$ git ls-files apps/docs/specs | grep design-system
（无输出）
$ git ls-files apps/docs/specs | wc -l
24            # 都是 architecture / proxy-engine / roadmap 等，与设计系统无关
```

它们在 PR #125 的分支 `docs/design-token-mapping` @ `ee8fd105`（`docs(design-system): add the color
system as the twelfth spec`）上。本轮读的是该分支的一份副本，并逐字节校验过一致：

```bash
for f in /tmp/osw-audit-specs/*.md; do
  git show ee8fd105:apps/docs/specs/$(basename $f) | cmp -s - "$f" || echo "DIFF $(basename $f)"
done
# 输出为空 => 12/12 完全一致
```

**因此本文引用这 12 份文档时只写文件名，不做相对链接**——本分支上链接会 404。

### 1.3 没做（不要从本文推断这些结论）

- 不改产品代码、不加运行时依赖（审计脚本零依赖，只用系统已有的 Chrome）。
- 未跑构建、未跑单测、未跑 lint（本轮是渲染差异审计，不是质量门）。
- 未做真机触屏、未做 RTL、未做 IME 组合态、未做动效降级（`prefers-reduced-motion`）——
  这几项规范里有要求，但不在本轮问题清单内，见 §6。
- 数据是**合成数据**，见 §2.4。

---

## 2. 方法（可复现）

### 2.1 环境与版本

| 项 | 值 |
| --- | --- |
| 工作区 | `/tmp/osw-audit`（git worktree），分支 `audit/design-diff`，HEAD `e3d632e9` |
| Node | v24.22.0 |
| pnpm | 12.14.0 |
| Vite | 8.3.4 |
| Chrome | Google Chrome 156.0.8078.47（headless=new） |
| 桌面视口 | 1440×900，`deviceScaleFactor=1` |
| 粗指针视口 | 390×844，`Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` |
| tray 视口 | 422×560（`apps/app/source/tray-panel.ts`：`PANEL_WIDTH 422`，高度 380–680） |

### 2.2 怎么跑起来的

```bash
cd /tmp/osw-audit
pnpm install --frozen-lockfile

# 渲染 console 的应用是 packages/console（@osw/console），dev 脚本就是 vite
node -e 'console.log(require("./packages/console/package.json").scripts)'   # { dev: "vite", ... }
cd packages/console && vite            # 端口 5173
```

dev server 起来后轮询到 200 才开始量测：

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/          # 200
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/tray.html # 200
```

**路由是 hash 路由**（TanStack Router hash history），所以页面 URL 形如
`http://localhost:5173/#/logical-models?theme=dark&lang=zh-CN`。
tray 是第二个 HTML 入口（`tray.html`），没有 router，主题靠 `prefers-color-scheme` 切换。

### 2.3 量测工具（复用既有脚本，未重写）

复用 `/home/openclaw/.openclaw/workspace/skills/design-review-loop/scripts/` 的
`shot.sh` / `audit.mjs` 思路，扩成 `audit-driver.mjs`（零依赖，手写 WebSocket 直连 CDP）。
用到的方法：`Page.navigate`、`Page.captureScreenshot`、`Runtime.evaluate`、
`Input.dispatchKeyEvent`、`Input.dispatchMouseEvent`、`Emulation.setDeviceMetricsOverride`、
`Emulation.setTouchEmulationEnabled`、`Emulation.setEmulatedMedia`。

工具本身被推翻重做过几次，**这几次修正直接改变了结论**，必须写在前面：

| 修正 | 原因 | 影响 |
| --- | --- | --- |
| 颜色解析支持 `oklab()` / `oklch()` | Tailwind v4 的 `color-mix()` 输出的是 `oklab()`，早期正则只认 `rgb()`，整类颜色被静默跳过 | 早期报告里的对比度数量偏低 |
| 截图改到「Tab 走查之前」 | 早期在走查之后截图，页面已被键盘滚动 | 截图与量测不同页 |
| 浮层用真实指针事件打开 | Radix 的 `DropdownMenu` 不响应合成的 `click()` | 早期 dropdown 运行的 `overlayNodesBefore: 0`，是**无效运行**，已重跑 |
| `--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4` | headless Chrome 默认 `(hover: hover)` / `(pointer: fine)` **全为 false**，而 Tailwind v4 把所有 `hover:` 关在 `@media (hover: hover) and (pointer: fine)` 后面；`Emulation.setEmulatedMedia` **改不动** hover/pointer | **不加这个 flag，任何 hover 量测都是「无变化」，是假阴性**；加了以后 `meta.hover=true` |
| 命中区改用 `elementFromPoint` 外推 | `getBoundingClientRect()` 看不见 Radix 的 `after:-inset-x-3 after:-inset-y-2` | 4 个「目标过小」是**假阳性**，见 §3.7 |
| 自造类名探针加「同层无类名兄弟」作基线 | `border-color` 不是继承属性，拿外层当基线会把 `border-b`、`border-2` 全判成颜色 token | 「同名不同色」的 token 数被高估，见 §3.9 |
| 探针排除 `dark:` / `data-[…]:` 变体覆盖 | 同一元素上 `bg-background` 与 `dark:data-checked:bg-primary-foreground` 并存时，渲染的是变体 | 变体覆盖不再被误报为撞车，单列统计 |
| 焦点环取 `box-shadow` 里**真正画出来的那一层** | Tailwind v4 的 ring 编译成多层 shadow，第一层是 `rgba(0,0,0,0)` 占位；取第一个 `rgb()` 会把每个环读成「透明黑」 | 暗色下「37/55 个环低于 3:1」是**纯假阳性**，修好后为 0，见 §3.6.1 |
| 量环外侧背景时跳过元素自身 | Radix 的命中区扩展（`after:-inset-y-2`）会让 `elementsFromPoint` 在**边框盒之外**也返回该元素，于是开关拿自己的轨道色当背景，算出 1.0 | 修好前 6 个开关被判 1.0:1，修好后全部 ≥3:1 |
| 焦点探针同样要支持 `oklab()` | 只认 `rgb()` 的解析器对 `oklab()` 环色返回 `null`，被降级成「没有环」 | 20 个停留点被误分类成「只有 color 变化」，修好后归位 |
| 读焦点样式前等过渡跑完 | 组件普遍带 `transition-all`（0.15s），`focus()` 后同一 tick 读到的是过渡前的值 | 少数量测落在过渡中间；加 200ms 等待 |

原始量测 JSON 落在 `/tmp/osw-audit-tools/reports2/`（34 次主矩阵）、
`/tmp/osw-audit-tools/reports/`（14 次粗指针）。这些是审计过程的原始记录，不在仓库里；
本文引用的每个数字都能从这两处 + 下面写出的脚本复算。

### 2.4 数据来源：合成数据（必须声明）

console 是静态 SPA，dev 下打 `http://127.0.0.1:19301/api`。真实后端不在本仓库，
所以审计期间跑了一个**零依赖的桩服务**（`stub-api.mjs`，217 行，仓库外），
按 `packages/contracts/source/schemas.ts` 的形状返回**伪造数据**，目的是让表格/表单/浮层
真的渲染出行和控件，而不是每页都停在网络错误态。

**因此：所有截图与量测都是在合成数据上取得的。** 版式、颜色、尺寸结论不受影响
（那些由组件与 token 决定），但凡涉及「某条真实数据长什么样」的结论，本文一律不下。

一处已知的截图瑕疵：`router-light.png` / `router-dark.png` 上有一条 toast
「Cannot read properties of undefined (reading 'nodes')」。这是桩服务返回的
`/router/graph` 形状与前端预期不符导致的，**不是产品缺陷**，本文不把它算作失败项。
（同时，这意味着 `/router` 页面上**图没画全**——见 §6 未核实项。）

---

## 3. 逐项实测结果

### 3.1 文字对比度（WCAG 1.4.3，要求 4.5:1）

规范判据（`design-system-accessibility.md` §1.1）：正文 ≥ **4.5:1**；且因为 osw 字号**全部 ≤16px**，
**没有大号文字 3:1 的豁免**（该文档 §1.1 明写「一律按 4.5:1 要求」，量测中确实没有 >16px 的失败元素）。

| 指标 | 值 |
| --- | --- |
| 原始失败实例（34 次运行的元素出现次数总和） | **233** |
| 其中禁用控件（1.4.3 豁免非活动控件） | 12 |
| 非豁免原始实例 | **221** |
| 折叠为「元素 + 配色 + 比值」的**独立缺陷** | **76** |
| 其中禁用豁免的独立缺陷 | 9 |
| **非豁免独立缺陷** | **67** |
| 不同的 (前景, 背景) 配色对 | **26** |
| 严重度分布（非豁免独立缺陷） | `4:1–4.5:1` 111 ／ `3:1–4:1` 101 ／ `2:1–3:1` 6 ／ `<2:1` 3 |
| 涉及页面（去重） | 12 个路由 + 3 个浮层 + tray，明暗都中招 |

**最差 5 条（每条：实测比值 / 前景 / 背景 / 在哪 / 证据）**

| # | 比值 | 前景 → 背景 | 元素与文案 | 页面（明/暗） | 证据截图 |
| --- | --- | --- | --- | --- | --- |
| 1 | **1.98** | `rgba(200,206,218,0.3)` → `rgb(58,58,58)` | `span.truncate`「选择日期范围」 | `request-logs`（暗） | `request-logs-dark.png` |
| 2 | **2.16** | `rgb(152,162,178)` → `rgb(233,235,240)` | `span.truncate`「选择日期范围」 | `request-logs`（明） | `request-logs-light.png` |
| 3 | **2.26** | `rgba(200,206,218,0.6)` → `rgb(58,58,58)` | `span.system-xs-regular.text-text-tertiary`「未配置」 | `logical-models`（暗） | `logical-models-dark.png` |
| 4 | **2.26** | `rgb(103,111,131)` → `rgb(242,244,247)` | 同上「未配置」 | `logical-models`（明） | `logical-models-light.png` |
| 5 | **2.96** | `rgb(7,148,85)` → `rgb(215,227,222)` | `span.group/badge.inline-flex.h-5.w-fit`「成功」 | `request-logs`（明） | `request-logs-light.png` |

第 1、2 条来自同一个组件：日期范围触发器里的 `text-text-quaternary`
（亮 `rgb(16 24 40 / 0.5)`、暗 `rgb(200 206 218 / 0.5)`）里再叠了一层
`--color-components-input-text-placeholder`（暗 `rgb(200 206 218 / 0.3)`），
两层半透明叠在一起，最终投影到 `rgb(233,235,240)`／`rgb(58,58,58)` 上只剩 1.98–2.16。

**按「一个修复动作能消掉多少」排序的系统性根因**

| 根因 | 实测比值 | 出现页数 | 说明 |
| --- | --- | --- | --- |
| `--color-text-quaternary` | 亮 **3.37**（`rgba(16,24,40,.5)` on `#fff`）／暗 **3.67**（`rgba(200,206,218,.5)` on `rgb(31,31,31)`） | 9 / 7 | 「OpenAI Completions」这类次级说明文字。**这个 token 本身就不满足 4.5:1**，与它压在什么面上无关 |
| `--color-text-tertiary` 压在**抬升面**上 | **4.22**（`rgb(103,111,131)` on `rgb(235,235,235)`）／**4.25**（on `rgb(236,236,236)`） | 11 | 表头、徽章内文字。压在页面底（`#fff`/`#fafafa`）上时是达标的，**只在抬升面上破线** |
| 徽章前景色 | 绿 **3.49**（`rgb(7,148,85)` on `rgb(233,245,240)`）、琥珀 **3.19**（`rgb(220,104,3)` on `rgb(252,244,230)`）、红 **4.17**（`rgb(217,45,32)` on `rgb(250,235,234)`) | 9 / 4 / 4 | 状态徽章的「文本色 + 同色浅底」组合全部略低于 4.5:1 |
| 暗色下 tertiary 压在 `rgb(57,57,57)` 上 | **3.71**（`rgba(200,206,218,.6)`）／**4.34**（on `rgb(33,41,48)`） | 2 / 2 | 同一 token 在暗色不同面上跨过 4.5 线 |
| 暗色下 tertiary 压在 `rgb(58,58,58)` 上 | **2.26** | 1 | 最差的一档 |

**逐页非豁免实例数（未去重，34 次运行）**：`logs` 明 19 / 暗 15，`overlay-request-contents-sheet` 明 30 / 暗 10，
`overlay-bill` 明 16，`request-logs` 明 15 / 暗 2，`router` 暗 15，`overview` 明 15，`overview-provider` 明 12，
`logical-models` 明 8 / 暗 2，`overlay-dropdown-menu` 暗 8 / 明 1，`overlay-provider-dialog` 暗 6 / 明 4，
`runtime-settings` 明 4 / 暗 2，`client-config` 明 3 / 暗 3，`model-management` 明 3 / 暗 1，
`tray` 明 7 / 暗 2，`overlay-command-select` 明 15 / 暗 2。**`request-rewrite-rules` 明暗各 1，是最干净的两页。**

### 3.2 非文字对比度：控件边界（WCAG 1.4.11，要求 3:1）

规范判据（`design-system-accessibility.md` §1.2 第 2 条）：控件的**边界与状态** ≥ 3:1。

原始 10 个实例，去重后 **10 个独立缺陷**，比值 **1.12 – 1.47**，**全部不达标**：

| 比值 | 页面（主题） | 元素 | 边界色 → 背景 | 文案 |
| --- | --- | --- | --- | --- |
| **1.12** | logical-models(明) | `button.flex.h-9.w-full.items-center` | `oklab(0.9234 … / 0.5)` → `rgb(255,255,255)` | 添加模型 |
| **1.13** | logical-models(暗) | 同上 | `oklab(0.3211 … / 0.5)` → `rgb(31,31,31)` | 添加模型 |
| **1.25** | logical-models(明) | `button.group.relative.inline-flex.h-8` | `rgb(230,230,230)` → `rgb(255,255,255)` | 运行中暂停服务 |
| **1.28** | onboarding(明) | `button.flex.h-20.flex-col.items-center` | `rgba(16,24,40,0.12)` → `rgb(250,250,250)` | 自定义供应商 |
| **1.28** | router(明) | `button.inline-flex.size-6.shrink-0.items-center` | `rgba(16,24,40,0.12)` → `rgb(255,255,255)` | （图标按钮） |
| **1.30** | logical-models(暗) | `button.group.relative.inline-flex.h-8` | `rgb(51,51,51)` → `rgb(31,31,31)` | 运行中暂停服务 |
| **1.42** | onboarding(暗) | `button.flex.h-20.flex-col.items-center` | `rgba(200,206,218,0.16)` → `rgb(18,18,18)` | 自定义供应商 |
| **1.44** | overlay-bill(明) | `button.inline-flex.h-8.items-center.gap-1.5` | `oklab(0.9999 … / 0.14)` → `rgb(81,84,89)` | 下载账单 |
| **1.46** | overlay-bill(暗) | 同上 | `oklab(0.9999 … / 0.14)` → `rgb(12,14,19)` | 下载账单 |
| **1.47** | router(暗) | `button.inline-flex.size-6.shrink-0.items-center` | `rgba(200,206,218,0.16)` → `rgb(31,31,31)` | （图标按钮） |

证据截图：`logical-models-light.png`、`logical-models-dark.png`、`onboarding-light.png`、
`router-light.png`、`router-dark.png`、`overlay-bill-light.png`。

注意这些不是「描边没画」，而是**描边只有 12%–16% 的透明度**：
`rgba(16,24,40,0.12)` 压在 `rgb(250,250,250)` 上等效于 `rgb(222,226,231)`，与背景差 1.28:1。
规范 `design-system-colors.md` §4.4 专门讨论过这个 16px 方块的描边，并说改用 `text-quaternary`
可以到 3.5:1 越过 1.4.11——**实测这几个边界的色值和那个讨论里说的不是同一个**。

### 3.3 非文字对比度：图标（要求 3:1）

原始 9 个实例 / 9 个独立缺陷，**5 个不同比值，全部不达标**，全部在 `/router`
（另 1 处在 `/request-logs` 的浮层里）：

| 比值 | 页面（主题） | 尺寸 | 背景 | 出现次数 |
| --- | --- | --- | --- | --- |
| **2.13** | router(明/暗各一) | 12 | `rgb(254,154,0)` | 2 |
| **2.35** | router(明/暗各一) | 12 | `rgb(247,144,9)` | 2 |
| **2.62** | router(明/暗各一) | 12 | `rgb(6,174,212)` | 2 |
| **2.76** | router(明/暗各一) | 12 | `rgb(23,178,106)` | 2 |
| **2.76** | overlay-command-select(暗) | 16 | `rgb(69,69,73)` | 1 |

即：**白色图标压在彩色实心底上**（橙 `rgb(254,154,0)`、`rgb(247,144,9)`、青 `rgb(6,174,212)`、绿 `rgb(23,178,106)`），
是 `/router` 工作流节点上的端口/协议图标。规范 `design-system-icons.md` 要求图标对底色 ≥3:1，
这几个色作为「实心底」时对白色最多只有 2.13–2.76。

### 3.4 placeholder 对比度（WCAG 1.4.3，要求 4.5:1）

placeholders 不是 1.4.3 的免除项（它不是「非活动控件」，只是提示文字），一律按 4.5:1 判。

| 指标 | 值 |
| --- | --- |
| 原始失败实例 | **36** |
| 不同 (前景, 背景, 文本) 组合 | **32** |
| 不同 (前景, 背景) 配色对 | **6** |
| 比值范围 | **1.84 – 2.16** |
| 字号 | 全部 **13px** |

| 比值 | 前景 → 背景 | 文本（举例） | 出现处 |
| --- | --- | --- | --- |
| **1.84** | `rgba(200,206,218,0.3)` → `rgb(73,73,73)` | 「例如：OpenAI / DeepSeek」「可选，例如 sk-...」「例如：30000」 | 暗色浮层里的输入框 |
| **1.87** | `rgba(200,206,218,0.3)` → `rgb(69,69,73)` | 「搜索供应商模型」 | `overlay-command-select`（暗） |
| **1.98** | `rgba(200,206,218,0.3)` → `rgb(58,58,58)` | 「搜索日志内容...」「搜索模型 ID...」「搜索规则」「{liveTps} TPS」「127.0.0.1」「9300」「3」「30」「300」「30000」「900」 | 暗色搜索框与数字输入 |
| **2.09** | `rgba(200,206,218,0.3)` → `rgb(46,46,46)` | 「搜索内容（Enter 定位下一处）」 | 暗色代码查看器搜索 |
| **2.10** | `rgb(152,162,178)` → `rgb(230,232,237)` | 「搜索内容（Enter 定位下一处）」 | 明色代码查看器搜索 |
| **2.16** | `rgb(152,162,178)` → `rgb(233,235,240)` | 上面那一整组在明色下的对应项 | 明色输入框 |

证据截图：`request-logs-light.png`、`request-logs-dark.png`、`logical-models-light.png`、
`runtime-settings-light.png`、`overlay-command-select-dark.png`、`overlay-request-contents-sheet-dark.png`。

根因是一个 token：`--color-components-input-text-placeholder`（亮 `#98a2b2`、暗 `rgb(200 206 218 / 0.3)`）。
它在亮色下对输入框底 `rgb(233,235,240)` 是 2.16，在暗色下对 `rgb(58,58,58)` 是 1.98。
**它压在什么面上都到不了 4.5:1。**

### 3.5 禁用态

1.4.3 明确豁免「非活动控件」，所以**不计入失败**，但记录实测值（用作对照）：

- 12 个禁用实例，比值范围 **2.61 – 5.26**（`disabled:opacity-50` 压暗后前景背景同时变化，
  与规范 `design-system-accessibility.md` §1.4 登记的缺口一致）。
- 另有 **4 个 `aria-disabled`** 的条目实测 **11.14 – 17.75**（`aria-disabled` 不降透明度，
  所以反而远高于阈值——语义上「不可用」但视觉上完全可读，属于两侧不一致）。

### 3.6 焦点可见性（WCAG 2.4.7 / 2.4.11）

方法：对 29 次运行（34 次里去掉 5 次粗指针）用 `Input.dispatchKeyEvent` 逐个发真实 `Tab`，
每停一站就**截图两次**——聚焦时一次、`blur()` 后一次，**逐字节比较**两张 PNG 的同一裁剪区。
两图完全相同 = 这一站**焦点指示不可见**（不是「看不出差别」，是像素级没有差别）。

| 指标 | 值 |
| --- | --- |
| 走过的 Tab 停留点总数 | **776** |
| 焦点指示**像素级不可见**的停留点 | **22** |
| 涉及的运行数 | **6 / 29** |
| 停留点被其它元素部分遮挡 | 86 |
| 停留点被 overflow 祖先裁剪 | 28 |
| 浮层运行（10 次）中跑到浮层外的 Tab 停留点 | **0**（10/10 焦点陷阱成立） |
| `Esc` 关闭 + 焦点归还 | 10/10 成立（见下表） |

**22 个不可见停留点的全部清单**

| 页面（主题） | 数量 | 元素 |
| --- | --- | --- |
| `router`（明 + 暗） | 9 × 2 = 18 | 8 个 React-Flow 连线 `g`（`Edge from protocol to condition` 等）+ 1 个 `opacity-0` 的 `在连线上插入节点` 按钮 |
| `overlay-dropdown-menu`（明 + 暗） | 1 × 2 = 2 | `div.z-50`（下拉菜单内容容器本身） |
| `tray`（明 + 暗） | 1 × 2 = 2 | `div.flex-1`（面板内容容器） |

`/router` 的 8 个连线为什么不可见，原因在计算样式里可直接读到：这 8 个元素**唯一变化的属性是
`outlineColor`，而 `outlineStyle` 始终是 `none`**——于是「聚焦时」与「失焦时」的像素完全相同。
`在连线上插入节点` 按钮带 `opacity-0`（只在 hover 时显形），键盘用户永远看不到它。
`overlay-dropdown-menu` 与 `tray` 各有一个**可聚焦的容器 `div`**（不是控件，却进了 Tab 序列），
它没有任何焦点样式。

证据截图：`router-light.png`、`router-dark.png`、`overlay-dropdown-menu-light.png`、`tray-light.png`。

**浮层行为（Radix 部分，全部通过）**

| 浮层（明/暗） | 打开后浮层节点数 | Tab 停留点落在浮层内 | `Esc` 关闭 | 关闭后焦点 |
| --- | --- | --- | --- | --- |
| overlay-bill | 1 | 全部 | ✅ | `BODY` |
| overlay-command-select | 2 | 全部 | ✅ | 触发按钮 |
| overlay-dropdown-menu | 1 | 全部 | ✅ | 触发按钮 |
| overlay-provider-dialog | 1 | 全部 | ✅ | `BODY` |
| overlay-request-contents-sheet | 1 | 全部 | ✅ | `BODY` |

（`overlay-dropdown-menu` 与 `overlay-command-select` 的第一版运行是**无效的**
——`overlayNodesBefore: 0`，即浮层根本没打开，因为合成 `click()` 对 Radix 无效。
已用真实指针事件重跑，上表是重跑后的结果。）

#### 3.6.1 焦点环本身的对比度（WCAG 1.4.11，要求 3:1）

「看得见」和「看得清」是两件事。上一节测的是前者；这一节测后者：
对 5 个页面配置 × 明暗共 10 次运行，逐个把可聚焦元素 `focus()`，等过渡跑完（`transition-all` 0.15s），
读出**指示色**（outline 色，或 `box-shadow` 里那层真正画出来的颜色——Tailwind v4 的 ring 会先给一层
`rgba(0,0,0,0)` 占位，取第一个 `rgb()` 会读成透明黑），再对**环外侧背景**算对比度。

| 指标 | 值 |
| --- | --- |
| 候选可聚焦元素（10 次运行合计） | 394 |
| 成功聚焦（其余 10 个拒绝聚焦） | 286 |
| `:focus-visible` 命中且有可测指示 | **280** |
| 指示机制分布 | `box-shadow`（ring）**234**、`background` **39**、`color` 7 |
| **低于 3:1 的** | **11**（全部是 `background` 型，全部在 `runtime-settings` 亮色） |
| 234 个 ring 型指示的最低对比度 | **14.89:1**（`logical-models` 亮色、`button[data-slot="tabs-trigger"]`，环 `rgb(23,23,23)` 压 `rgb(235,235,235)`） |

**234 个 ring 型焦点环全部远超 3:1，最低 14.89。** 但 `background` 型里有一处实打实不达标：

`runtime-settings` 的**亮色**下，11 个 `input[data-slot="input"]` 在聚焦时**唯一可见的变化**
是背景从 `rgb(255,255,255)` 变成 `rgb(249,250,251)` —— **1.05:1**（其余 3 个是 1.06 / 1.11 / 1.36）。
要求 3:1。这些输入框的类里写的是：

```
… transition-colors outline-none   （input.tsx:15）
… focus:border-components-input-border-active focus:bg-components-input-bg-active
```

三件事叠在一起：

1. 用的是 `focus:` 而**不是** `focus-visible:` —— 鼠标点进去也会亮，与本仓库其余组件的行为不一致
   （规范 §3.3 规则 4 的方向是「组件必须自带 `focus-visible:`」）。
2. 类里的 `outline-none` 把 `outline-style` 钉成 `none`，于是
   `index.css:681-689` 那条全局 `input:focus-visible { outline: 1px solid hsl(var(--ring)) }`
   **对输入框完全不起作用**——这正是规范 §3.3 规则 4 说的「不要靠全局 outline 兜底」的另一面：
   这里不是「靠兜底」，而是「**兜底被组件自己关掉了**」。
   （实测证据：同一个开关聚焦后 `outline` 的计算值是 `1px none rgb(23,23,23)`——宽度有了、样式是 `none`。）
   `outline-none` 在 `components/ui/` 下有 **25 个文件**在用。
3. `focus:border-components-input-border-active` 在**亮色下没有产生可见变化**（实测 `borderTopColor` 聚焦前后相同），
   所以亮色下只剩那 1.05:1 的背景色差。暗色下同一套类没有出现低于 3:1 的项。

证据截图：`runtime-settings-light.png`（表单区）。

全局兜底规则在 `packages/console/source/styles/index.css:681-689`：

```css
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 1px solid hsl(var(--ring));
  outline-offset: 2px;
}
```

—— 这条兜底规则覆盖 `button` / `input` / `textarea` / `select`，**没有 `<a>`**，
而且如上所述会被组件的 `outline-none` 关掉。按规范 §3.3 规则 4，它本来就只是「保险」不是实现，
真正的判据是每个组件自带的 `focus-visible:` 写法（规范 §3.2 数出 **140 处 / 41 个文件**，
且写法不统一：`ring-2` / `ring-3` / `ring-[3px]` / `ring-1`、`ring-ring/50`、`ring-primary/40`、`ring-white/35` 等）。
本轮只量了这些写法的**最终渲染结果**（上面的对比度表与像素判定），**没有逐处核对写法是否归一**——
「宽度是否都统一到 2px」「是否都走同一个 token」这两条规范要求，本轮**未核实**（见 §6 第 11 条）。

「选择器里没有 `<a>`」这一点值得单独登记：§3.9 里那条「同名不同色」的链接能被键盘聚焦，
却不吃这条全局兜底（它自己带了 `focus-visible:bg-accent focus-visible:text-primary`，
所以没有落进上面 22 个不可见停留点里；靠的是组件自己而不是兜底）。

### 3.7 目标尺寸（WCAG 2.5.8 AA 24×24；2.5.5 AAA 44×44）

规范判据（`design-system-accessibility.md` §2.1/§2.2）：AA 下限 **24×24 CSS px**，
且 24px 不是「视觉尺寸」而是「目标尺寸」；§2.3 记录了 Radix 原语用
`after:absolute after:-inset-x-3 after:-inset-y-2` 扩展命中区。

**先说方法上的一个自我推翻。** 第一版量测用 `getBoundingClientRect()` 判尺寸，报了 4 处失败
（桌面：provider 弹窗里 32×18.4 的开关、请求详情抽屉里 16×16 的按钮）。
但 `getBoundingClientRect()` **看不见伪元素**，而 Radix 的命中区恰好是靠伪元素撑开的，
所以这 4 个可能是假阳性。改用 `elementFromPoint` 从元素中心向四个方向逐像素外推、量出
**真实命中矩形**后重测。结论是**全部 4 处都是假阳性，重测后 22 次运行的 FAIL 数都是 0**：

> 32×18.4 的开关，实际命中区是 **54×34**（box 32×18.4 → hit 54×34，即
> `after:-inset-x-3 after:-inset-y-2` 撑出的 12/8px 扩展确实生效），直接过 24×24。

**重测后的完整结果（桌面 1440×900，22 次运行 = 11 个页面配置 × 明暗）**

| 页面（明/暗各一次） | 目标总数 | 框 <24px | 靠**命中区**达标 | 靠**间距例外**达标 | **FAIL** |
| --- | --- | --- | --- | --- | --- |
| logical-models | 58 | 22 | 1 | 21 | **0** |
| runtime-settings | 42 | 5 | 0 | 5 | **0** |
| model-management | 38 | 2 | 1 | 1 | **0** |
| overlay-provider-dialog | 38 | 2 | 1 | 1 | **0** |
| overview | 29 | 1 | 0 | 1 | **0** |
| overlay-bill | 29 | 1 | 0 | 1 | **0** |
| overview-provider | 25 | 2 | 0 | 2 | **0** |
| request-rewrite-rules | 24 | 2 | 2 | 0 | **0** |
| overlay-dropdown-menu | 24 | 2 | 2 | 0 | **0** |
| overlay-request-contents-sheet | 22 | 3 | 0 | 3 | **0** |
| overlay-command-select | 16 | 0 | 0 | 0 | **0** |

（表里的「目标总数」比 §3.7 上面主矩阵运行里的数字大——例如 `logical-models` 这里 58、
主矩阵 35。原因是命中区探针不做主驱动那条「元素顶部超过 3 倍视口高度就不计」的截断，
也不剔除 `aria-hidden` 祖先里的元素，所以它数到的是**更完整**的一份目标清单。
两处都不影响 FAIL 判定，但引用数字时要知道它们不是同一个口径。）

**框小于 24px、但实际达标的目标（全部清单，去重后 8 类）**

| 框 | 有效命中区 | 判定依据 | 与最近目标的距离 | 元素 | 出现页数 |
| --- | --- | --- | --- | --- | --- |
| 32×18.4 | **54×34** | 命中区 ≥24 | — | `button[data-slot="switch"]` | 5 |
| 16×16 | 16×16 | 间距例外 | **173.0** | `button[data-slot="tooltip-trigger"]`「近 12 次已完成请求」 | 3 |
| 16×16 | 16×16 | 间距例外 | 173.0 | `button`「复制请求 ID」 | 1 |
| 16×16 | 16×16 | 间距例外 | 231.3 | `button[data-slot="tooltip-trigger"]`「窗口内缓存读取 Token ÷ 输入 Token 总量。」 | 2 |
| 106.4×16 | 108×16 | 间距例外 | 61.4 | `a.group/provider`「查看 OpenAI 数据分析」 | 1 |
| 249.3×16 | 121×16 | 间距例外 | 88.5 | `a.group/provider`「查看 Anthropic 数据分析」 | 1 |
| 71.6×16 | 72×16 | 间距例外 | 274.9 | `button`「用浏览器打开 openai.com」 | 2 |
| 48×16 | 49×16 | 间距例外 | 144.6 | `button.truncate`「统计分析」 | 1 |

**所以对 2.5.8（AA 24px）的结论是：桌面与粗指针两侧、全部页面、明暗两套主题，实测 0 处失败。**

这里必须同时说明：**规范 `design-system-accessibility.md` §2.2 第 1 条写的「这条没有例外」比实现更严。**
实现里确实有大量 <24px 的目标（`size-4` = 16×16 的提示触发器、`h-4` = 16px 高的链接行），
它们靠的是 2.5.8 自带的**间距例外**（以每个目标为中心画 24px 直径圆、圆互不相交）过关——
实测最近的目标距离是 61–275px，远大于 24px，所以例外成立。
规范在同一节的括号里预判「密集工具栏通常不满足间距例外」——**在 osw 这几个页面上这个预判不成立**，
它们是稀疏排布。这是规范与实现之间**方向相反**的一处差异：不是实现达不到规范，
而是规范把 AA 写成了比 WCAG 原文更严的「无例外」，实现落在 WCAG 原文之内。

两点保留（不影响上面的「0 失败」，但影响它能外推到多远）：

- 命中区外推最多走 60px（`CAP`），走满即停；若某个元素的真实命中区大于 60px，
  这里记的是 60。开关量到 34px 高，未触顶。
- 有 3 个目标的**中心点被其它元素盖住**（`covered`），无法从中心外推，于是退回用边框盒参与间距计算。
  这 3 个都是 16×16 的 `size-4` 触发器。

`pointer: coarse` 一侧（390×844，触摸模拟，7 个页面 × 明暗 = 14 次运行）：

| 页面（明/暗） | 目标总数 | 框 <24px | 判定 FAIL |
| --- | --- | --- | --- |
| logical-models | 35 | 13 | **0** |
| model-management | 37 | 1 | **0** |
| overview | 29 | 1 | **0** |
| overview-provider | 25 | 2 | **0** |
| request-logs | 16 | 0 | **0** |
| router | 25 | 0 | **0** |
| runtime-settings | 31 | 3 | **0** |

命中区 ⊇ 边框盒，所以「框都小于 24px 但靠间距例外过关」这个结论在粗指针侧只会更宽松：
**14 次粗指针运行同样 0 失败。**

**关于 2.5.5（AAA 44×44）**：把同一套粗指针运行的阈值调到 **44px** 再跑一遍
（10 个页面配置 × 明暗 = 20 次运行），失败数如下——**这是 AAA 项，不是本轮 AA 审计的失败项，
只作登记**：

| 页面 | 目标总数 | 框 <44px | FAIL（44px 阈值） |
| --- | --- | --- | --- |
| overlay-provider-dialog | 42 | 42 | **28** |
| model-management | 37 | 37 | **25** |
| router | 25 | 24 | **17** |
| request-rewrite-rules | 24 | 24 | **16** |
| logs | 18 | 18 | **13** |
| overview | 29 | 29 | **12** |
| logical-models | 35 | 35 | **10** |
| overview-provider | 25 | 25 | **10** |
| request-logs | 16 | 16 | **10** |
| runtime-settings | 31 | 31 | **10** |

即：**按 44px 衡量，几乎所有目标都不达标**（与规范 §2.3 的登记一致：仓库里 `size-11` 0 处、
精确 `h-11` 0 处、`min-h-11` 只有 `questionnaire.tsx` 的 7 处）。
规范 §2.2 自己也写明 osw 是桌面鼠标产品、24px 是可接受的下限，所以本文**不把这一栏列为失败**。

### 3.8 同名不同色的类名（规范称 81 处）

规范 `design-system-colors.md` §5.1 列了 4 对同名不同色的类名，合计 **81 处**
（`text-primary` 29 / `text-secondary` 1 / `text-destructive` 12 / `text-muted-foreground` 39）。

**静态复现：4 对里的 2 对能复现，另 2 对复现不出规范给的数字。**

复现命令（非连字符边界，允许 `hover:` / `dark:` / `data-[…]:` 前缀）：

```bash
grep -rhoE '(^|[^a-zA-Z0-9-])text-primary([^a-zA-Z0-9-]|$)' \
  --include='*.tsx' --include='*.ts' packages/*/source apps/*/source | wc -l
```

| A 层类名 | 规范给的用量 | 本轮复现 | C 层对应 | 规范给的用量 | 本轮复现 |
| --- | --- | --- | --- | --- | --- |
| `text-primary` | 29 | **13** | `text-text-primary` | 155 | **160** |
| `text-secondary` | 1 | **3** | `text-text-secondary` | 92 | **92** ✅ |
| `text-destructive` | 12 | **12** ✅ | `text-text-destructive` | 49 | **51** |
| `text-muted-foreground` | 39 | **39** ✅ | `text-text-tertiary` | 241 | **244** |
| **合计** | **81** | **67** | | 537 | 547 |

试过的四种数法（精确 token / 非连字符边界 / 全仓库全文件 / 逐行）都没得到 29 与 1。
C 层那一侧的三个数字（92 / 244 / 160）非常接近规范值，A 层这一侧差得远——
**差异原因未核实**（见 §6）。

**运行时：没有观察到任何一个 token 在同一页面同一主题下渲染出两种颜色。**

对 11 个路由 + tray + 3 个浮层 × 2 套主题共 30 次运行做了系统扫描（探针见 §2.3 的两次修正）：
每个运行里，凡是「只带一个颜色 token」的可见元素，读它的计算值；同一 token 出现 ≥2 个不同值的即为命中。
**30 次运行全部 `conflicting = 0`。**

**但这不等于「撞车不存在」——它只是「不裸奔」。** 撞车在**状态**里露出来，实测证据如下：

`/logical-models` 的供应商链接（`packages/console/source/pages/logical-models/components/provider-model-row.tsx:175`）
根类同时写了 C 层的 `text-text-primary` 和 A 层的 `hover:text-primary`：

```
group/provider … text-text-primary … hover:text-primary focus-visible:bg-accent focus-visible:text-primary
```

用真实指针 hover 实测（`meta.hover: true`，确认 hover 媒体查询已生效）：

| 主题 | 静止 | hover 后 | 说明 |
| --- | --- | --- | --- |
| 明 | `rgb(16, 24, 40)` | `rgb(23, 23, 23)` | C 层冷灰 `#101828` → A 层纯灰 `#171717` |
| 暗 | `rgb(251, 251, 252)` | `rgb(250, 250, 250)` | `#fbfbfc` → `#fafafa` |

也就是说：**同一个 `primary` 语义，静止时和 hover 时取的是两层的不同颜色。**
亮色下差 7/255（肉眼几乎不可见，但这是「一个语义两条路径」的直接证据）；
暗色下差 1/255。证据：`hover-logical-models-light.png`、`hover-logical-models-dark.png`。

规范 §5.1 的判断（「两个『主文本色』并存，是两个体系」）在**渲染结果**上成立；
但它的 81 处**在源码里数不出来**，而且**在渲染后不可见**（除非触发 hover 这类状态）。
这两点必须一起写进结论，否则「81 处」会被当成一个能直接验证的数字用。

### 3.9 明暗两套机制：56 处 `dark:` vs 121 个 `.dark` 覆盖

规范 `design-system-theming.md` §1.4 的计数**完全可复现**：

```bash
cd packages/console/source
grep -rho '\bdark:' --include='*.tsx' . | wc -l   # 56   （规范值 56 ✅）
grep -rl '\bdark:' --include='*.tsx' . | wc -l    # 22   （规范值 22 ✅）
```

逐文件分布也与规范 §1.4 的表逐行吻合（`bubble.tsx` 4、`questionnaire.tsx` 3、
`request-contents-stage.tsx` 2、`input-otp.tsx` 2、`input-group.tsx` 2，其余 17 个文件各 1）。

**规范少数了一块**：它只 glob 了 `*.tsx`。全仓库再算 `*.ts`，还有 **13 处、4 个文件**：

| 文件 | `dark:` 处数 |
| --- | --- |
| `apps/www/source/screenshots.ts` | 7 |
| `packages/console/source/catalog/clients/index.ts` | 3 |
| `apps/app/source/host-ipc.ts` | 2 |
| `packages/console/source/catalog/providers/index.ts` | 1 |

即真实总数是 **69 处 / 26 个文件**，不是 56 处 / 22 个文件。
（`apps/www` 那 7 处在截图脚本里，不进产品界面，但也确实写着 `dark:`。）

`index.css` 的 `.dark` 覆盖（本轮按块统计，与规范 `design-system-tokens.md` §7 一致）：

| 块 | 起始行 | 变量数 |
| --- | --- | --- |
| `.dark`（C 层覆盖） | `styles/index.css:291` | **82** |
| `.dark`（B 层 HSL 通道覆盖） | `styles/index.css:597` | **39** |
| 合计 | | **121** |

**两套机制会不会打架？实测有一个具体页面能看出它们确实并存。**

`packages/console/source/components/ui/switch.tsx:27`（开关的滑块）：

```
bg-background … dark:data-checked:bg-primary-foreground … dark:data-unchecked:bg-foreground
```

同一个元素上，底座是 token（`bg-background`），两个状态在暗色下改用 `dark:` 变体去覆盖它。
实测中带这套写法的开关出现在 4 个页面、共 21 个元素上。这不是「冲突」（变体优先级更高，
结果确定），但它是**同一属性有两条表达路径**的活样本——与 §3.8 的 hover 撞车同源。

`checkbox.tsx:27` 里还有一对纯冗余：

```
data-checked:bg-primary … dark:data-checked:bg-primary
```

明暗两侧写同一个 token，`dark:` 那半句不产生任何效果。

**真正会「漂」的一处是字面色。** `packages/console/source/pages/router/components/workflow-node.tsx:66`：

```
flex h-full w-full flex-col border-amber-300/70 bg-amber-50/80 hover:bg-amber-50
  dark:border-amber-400/25 dark:bg-amber-400/10 dark:hover:bg-amber-400/15
```

这里用的是 Tailwind **调色板字面色**（`amber-50/80`、`amber-300/70`）而不是语义 token，
而 `.dark` 里没有任何变量能管到它，于是明暗两套各自手写了一遍。这同时违反规范总纲的两条铁律：
铁律 1（禁止视觉命名）、铁律 2（品牌层只允许存在于 `index.css` 的 `@theme` 与 `.dark`）。
证据截图：`router-light.png`、`router-dark.png`。

### 3.10 表格密度（`design-system-data-display.md` §1.1/§1.2）

规范给的规格（该文档自己标了「**推算，非实测**」）：表头 **32px**（`h-8`）、
正文行 **36px** 文字 / **40px** 带 `h-5` 徽章。

实测（量 `thead > tr`、第一个 `tbody > tr`、首个单元格、行内徽章的实际 `getBoundingClientRect()`）：

| 页面（明暗同值） | 表头类名 | 表头高 | 行类名 | **行高** | 行数 | 单元格内距 | 徽章高 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `request-logs` | `h-8` | **32.5** | `cursor-pointer border-b border-border/40` | **41** | 12 | 10/10 | 20 |
| `overlay-bill`（账单弹窗） | （无高度类） | **32.5** | `border-b border-border/40 transition-colors` | **41** | 3 | 10/10 | 20 |
| `request-rewrite-rules` | `border-b border-border/40 transition-colors` | **40** | `has-aria-expanded:bg-state-base-hover …` | **61** | 2 | 10/10 | 20 |

读法：

- 前两处**与规范推算基本吻合**：表头 32.5px（`h-8` = 32px + 1px 边框，规范写 32），
  正文 41px（规范写「带 `h-5` 徽章时 40px」，实测行内徽章确实是 20px = `h-5`），
  差 1px 是 `border-b`。
- **`request-rewrite-rules` 与规范差距明显**：表头 **40px**（差 8px），行高 **61px**（差 21–25px，即约 1.5 倍）。
  它的表头 `tr` 上根本没有高度类，行高由内容撑开。
- 其余页面（`logical-models`、`model-management`、`router`、`logs`、`overview` 等）
  DOM 里**没有 `<table>` 元素**——它们的列表是 div 布局，所以「表格密度」这一项对它们不适用，
  不能拿本表去推断它们。

证据截图：`request-logs-light.png`、`overlay-bill-light.png`、`request-rewrite-rules-light.png`。

### 3.11 字号与行高（`design-system-typography.md` §4 / §10）

规范 §4 的规则：行高只有 **16 / 20 / 24px** 三档，≤13px 一律 16px。
规范 §10 把「`--text-2xs` 有没有自带行高」标成 `[未核实]`。

**§10 的「未核实」本轮可以结掉。** 方法是往页面里注入一个 `line-height: 100px` 的容器
（100px 是产品里不存在的值），再往里放带目标类的 `span`，读回它自己的行高：

| 注入的类 | 字号 | 读回的行高 | 是否自带行高 |
| --- | --- | --- | --- |
| `text-2xs` | 11px | 100px（继承值） | **否** ❌ |
| `text-xs` | 12px | 16px | 是 |
| `text-sm` | 14px | 20px | 是 |
| `system-2xs-regular` | 11px | 16px | 是 |
| `system-2xs-medium` | 11px | 16px | 是 |
| `system-xs-regular` | 12px | 16px | 是 |

即：**A 层的 `text-2xs` 只设字号、不设行高**（这与 shadcn 上游一致），
而 C 层自己的 `system-2xs-*` 把 11px 配成 16px，符合 §4 的规则。

**但这条并没有造成实际后果**：在 5 个页面 × 明暗共 10 次运行里扫遍所有带
`text-*` / `system-*` / `leading-*` 类且可见的元素，**`text-2xs` 在渲染出来的 DOM 里 0 次出现**
（出现的是 `system-2xs-medium` 28 次、`system-2xs-medium-uppercase` 32 次、
`system-2xs-regular` 60 次等），而**所有这些元素的行高都落在 16 / 20 / 24px 里，没有一个是例外值**。

所以两条结论：

1. 规范 §4 的「行高只有三档」在实测的这 5 个页面上**成立**（样本：`logical-models`、
   `model-management`、`request-logs`、`request-rewrite-rules`、`overlay-bill`，明暗各一次）。
2. 规范 §10 的 `[未核实]` 答案是「`--text-2xs` 不带行高」，但因为**没人用它**，
   它是一颗没引爆的雷，不是一个现行缺陷。**要小心别把这两件事混成一条。**

---

## 4. 失败清单（按严重度排序）

排序依据：① 是否违反规范里的「无例外」条款；② 影响面（页数 × 元素数）；③ 是否可被用户直接感知。

| # | 严重度 | 规范要求 | 实测 | 差距 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | **高** | 正文 ≥4.5:1，osw 无大号文字豁免（`accessibility.md` §1.1） | 233 个失败实例 → **67 个非豁免独立缺陷**、26 组配色；最差 **1.98:1** | 最差处只有要求的 **44%**；`--color-text-quaternary` 全量不达标（亮 3.37 / 暗 3.67） | §3.1 表；`request-logs-dark.png` |
| 2 | **高** | placeholder 同属正文，≥4.5:1 | 36 个实例、32 段文本、6 组配色，**1.84 – 2.16** | 全部不足要求的一半 | §3.4 表；`overlay-command-select-dark.png` |
| 3 | **高** | 每个可聚焦元素要有可见焦点指示（`accessibility.md` §3；2.4.7） | 776 个 Tab 停留点中 **22 个**聚焦/失焦像素完全相同 | `/router` 8 条连线的 `outlineStyle` 恒为 `none`；另有 2 个容器 `div` 不该进 Tab 序列 | §3.6 表；`router-dark.png` |
| 3b | **高** | 焦点指示本身 ≥3:1（1.4.11） | 280 个可测指示里 **11 个是 1.05–1.36:1**，全部是 `runtime-settings` 亮色的输入框；其唯一可见变化是背景 `#fff`→`#f9fafb` | 只有要求的 **35%**；且这些输入框的 `outline-none` 把全局 `input:focus-visible` 兜底关掉了 | §3.6.1；`runtime-settings-light.png` |
| 4 | **高** | 控件边界与状态 ≥3:1（1.4.11） | 10 处边界 **1.12 – 1.47**，无一处达标 | 最差处只有要求的 **37%** | §3.2 表；`logical-models-light.png` |
| 5 | **中** | 图标对底色 ≥3:1（`icons.md`） | 9 个实例、5 个比值 **2.13 – 2.76**，全部在 `/router` | 白图标压彩色实心底 | §3.3 表；`router-light.png` |
| 6 | **低**（原判「中」，已下调） | 任何可点元素 ≥24×24（`accessibility.md` §2.2 第 1 条，规范写「无例外」） | 桌面与粗指针两侧、22+14 次运行 **0 处失败**；确有一批 <24px 的目标（`size-4` 16×16、链接行 16px 高），但**靠 2.5.8 自带的间距例外全部过关** | **规范比 WCAG 原文更严**，不是实现不达标 | §3.7 |
| 7 | **中** | 语义命名、品牌层只允许在 `@theme` 与 `.dark`（总纲铁律 1/2） | `workflow-node.tsx:66` 用 `amber-50/80`、`amber-300/70` 等字面色，且明暗各手写一遍 | 该处完全不在设计系统内 | §3.9；`router-dark.png` |
| 8 | **中** | 同一语义只有一个类名（`colors.md` §5.1） | 4 对同名类名并存；`hover:text-primary` 与 `text-text-primary` 在同一元素上取两层的值（明 `#101828`→`#171717`） | 语义归属不唯一 | §3.8；`hover-logical-models-light.png` |
| 9 | **中** | 表格密度：表头 32px、行高 36–40px（`data-display.md` §1.1/§1.2，规范自标「推算，非实测」） | `request-logs` 与账单弹窗吻合（32.5 / 41）；**`request-rewrite-rules` 是表头 40px、行高 61px** | 表头差 **+8px**，行高差 **+21px**（约 1.5 倍） | §3.10；`request-rewrite-rules-light.png` |
| 10 | **信息** | 行高只有 16/20/24 三档（`typography.md` §4） | 实测**成立**：10 次运行里所有带字号 token 的元素行高都在这三档内 | 无差距；同时结掉 §10 的 `[未核实]`（`--text-2xs` 不带行高，但 0 处在用） | §3.11 |

---

## 5. 没有改动任何东西

- **产品代码零改动**：`packages/console`、`apps/*` 的实现文件在本轮审计中**一个字节都没改**。
  命令核对：`git status --short` 在本分支上只有两行，都是新增，没有 `M`/`D`：

  ```
  ?? apps/docs/specs/assets/
  ?? apps/docs/specs/design-system-audit.md
  ```
- **规范零改动**：12 份规范不在本分支上（`git ls-files apps/docs/specs` 的 24 个文件里没有它们），
  本轮只读 `/tmp/osw-audit-specs/` 下的副本，没有写过它们。
- **没有新增依赖**：审计脚本（`audit-driver.mjs` 及若干探针）都是零依赖 Node + 系统已有 Chrome，
  且全部在仓库外（`/tmp/osw-audit-tools/`）。仓库里新增的只有这一份报告和 `assets/` 下的截图。
- **没有新建分支**：工作全程在 `audit/design-diff`（起点 `e3d632e9`，与远端 main 同点）。

改动清单（本 PR 的全部内容）：

```
apps/docs/specs/design-system-audit.md           （本文）
apps/docs/specs/assets/design-system-audit/*.png （50 张，5.0 MB；34 张主矩阵 + 14 张触屏 + 2 张 hover 证据）
```

---

## 6. 测不到 / 未核实

诚实登记，这些**不构成结论**：

1. **规范的 81 处数不出来。** §3.8 的四种数法都得不到 29 与 1。差异原因未核实
   （可能规范写于另一个代码快照，也可能它的 grep 与我试的不同）。因此本文只报
   「4 对类名确实并存」与「运行时 30 次运行 0 个 token 同页两色」，不报「81 处」。
2. **`/router` 页面本身没渲染完整。** 桩服务的 `/router/graph` 形状与前端预期不符，
   页面上有报错 toast、图画不全。所以 §3.3 的图标结论只覆盖**已经画出来的**那些节点，
   工作流图完整渲染后是否还有别的图标/对比度问题，**测不到**。
3. **焦点环对比度只覆盖 5 个页面配置。** §3.6.1 的 280 个可测指示来自 `overview`、
   `overview-provider`、`logical-models`、`request-logs`、`runtime-settings` × 明暗，
   **不含 `/router`、`/logs`、`/model-management`、`/client-config`、`/onboarding`、tray 与全部浮层**。
   所以「`runtime-settings` 亮色输入框 1.05:1」是本轮**发现的具体缺陷**，
   而「其余页面没有类似问题」**只是本轮没测到**，不是结论。
4. **只能看出「有没有差别」，看不出「够不够显眼」。** 像素级比较能证明 22 个停留点完全没有指示，
   但不能证明剩下 754 个的指示在真实屏幕上够不够清楚。截图是人眼判断的辅助，不作为结论。
5. **触屏是真模拟，不是真机。** 390×844 + `setTouchEmulationEnabled` 是 CDP 模拟，
   不是真手机。真机上的点击热区、`pointer: coarse` 分支、双指缩放等未验证。
6. **`prefers-reduced-motion` / RTL / IME 组合态未测**（规范有要求，本轮范围外）。
7. **暗色模式只走 `?theme=dark` 参数与 `prefers-color-scheme` 两条路径**，
   `html.dark` 的另外几个读写点（规范 `theming.md` §0.3 说有 4 个）没有逐个验证。
8. **合成数据**（§2.4）：截图与量测都基于桩服务返回的伪造数据。
   凡是「真实数据下会不会溢出/换行/截断」类的问题，本轮测不到。
9. **`overlay-bill` 页面上有 16 个非豁免对比度失败实例**，但账单弹窗的部分内容在
   1440×900 里需要滚动才能看全，滚动区外的部分没有量到，所以「账单弹窗一共多少处」
   这个数字**只有本轮的 16**，可能偏低。
10. **`request-rewrite-rules` 的表头 40px / 行高 60.5–61px** 这一项，是 §3.10 实测表里
    唯一与规范推算值差得较大的一处（规范 32 / 36–40）。但规范自己标了「推算，非实测」，
    且没说清 `h-8` 是加在 `thead > tr` 还是 `th` 上——**这算不算偏差，取决于规范的意图**，
    本文不替这个判定投票。
11. **「焦点环是否归一」没有逐处核对写法。** §3.6 量的是**渲染结果**（有没有指示、对比度多少），
    规范里另外三条**写法级**要求——「宽度统一 2px」「颜色统一走一个 token」
    「禁止任意值写法（如 `ring-[3px]`）」——本轮**只统计了 `outline-none` 出现在 25 个
    `components/ui/*.tsx` 里**这一个侧面，没有按 class 字符串逐个核对
    `focus-visible:ring-*` 的宽度值与颜色 token 是否一致。要回答它需要的是源码级 grep
    清单，不是运行时量测，本轮范围外。
