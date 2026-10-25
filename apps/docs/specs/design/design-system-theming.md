# 明暗两套：机制与验证

> 本文是 [`design-system.md`](./design-system.md) 第二层（刻度与状态层）在**明暗主题**上的细则，
> 覆盖 issue #124 的缺口：**明暗两套的验证方法**。
>
> 它回答的不是"有哪些 token"（那是 [`design-system-tokens.md`](./design-system-tokens.md) §1），
> 而是 **"怎么保证 `.dark` 的覆盖是完整的"**——机制 + 可执行 checklist。
>
> **本文不改代码**：现状一律标注，缺口登记为待办。

## 0. 载体与状态源

### 0.1 载体是 `<html>` 上的一个类名

| 项 | 值 |
| --- | --- |
| 类名 | `dark`，加在 **`<html>`**（`document.documentElement`）上 |
| Tailwind 变体 | `@custom-variant dark (&:is(.dark *))`（`styles/index.css:8`）——**后代选择器**，所以类必须在 `<html>` 或更高的祖先上 |
| 原生控件 | `html { color-scheme: light }`（`:658`）/ `html.dark { color-scheme: dark }`（`:661`）——滚动条、原生下拉跟着走。**日期选择器不在此列**：应用用的是自己的 `DatePicker` / `DateRangePicker`（popover + 日历），外观由 token 控制，与 `color-scheme` 无关 |
| 测试 | `shell/document-theme.test.tsx`（覆盖亮/暗切换与"从暗切回亮时 `<html>` 上不应残留"） |

### 0.2 状态：偏好是三相，生效值是两相

`lib/theme-mode.ts` 把两个概念分开了（该文件注释写明了理由）：

| 类型 | 取值 | 含义 |
| --- | --- | --- |
| `ThemeMode` | `'system' \| 'light' \| 'dark'` | **用户偏好**，要持久化、要进设置页、要告知主进程 |
| `Theme` | `'light' \| 'dark'` | **算完之后实际生效的值** |

**解析顺序**（`hooks/use-appearance.ts` 与 `public/boot.js:4-6` 两处必须一致）：

```
URL 的 ?theme=  >  持久化偏好（localStorage `osw-ui` 的 themeMode）  >  系统（prefers-color-scheme）
```

### 0.3 `.dark` 类有 **4 个读写点**，验证时必须全看

这是本节最重要的事实——**主题不是"一个 hook 管到底"**：

| # | 位置 | 角色 | 说明 |
| --- | --- | --- | --- |
| 1 | `packages/console/public/boot.js:39` | **写** | 绘制前定主题，防"先闪白底再变深色"。**必须是非模块脚本**——`<script type="module">` 是延迟执行的，画完才跑（`boot.js:13` 原话）。`index.html:8` 与 `tray.html:34` 都引它 |
| 2 | `shell/document-theme.ts:20` | **写** | React 侧的落地点：`document.documentElement.classList.toggle('dark', theme === 'dark')`。**控制台主界面与托盘面板两个 HTML 入口共用它**（该文件注释解释了为什么不各写一遍） |
| 3 | `components/ui/animated-theme-toggler.tsx:75` | **写** | 主题开关：在 View Transition 里改类名。**它绕过了 1 与 2** |
| 4 | `pages/model-management/components/provider-icon.tsx:71`、`pages/client-config/components/client-icon.tsx:13` | **读** | `document.documentElement.classList.contains('dark')` + `MutationObserver` 监听 `class` 变化——**供应商标志与客户端标志需要知道当前明暗来选图形** |

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **新增读取明暗的代码，用 `useResolvedAppearance().theme`，不要读 `<html>` 的类名**。直接读类名等于把"主题怎么承载"这件事泄漏到业务组件里——`animated-theme-toggler.tsx:10-11` 的注释正是这个意思（**"某天主题换一种承载方式（类名改属性、多出「高对比」一档），必然只改一处"**）。现有 2 处读取者需要在**主题承载方式变化时**一起改 |
| 2 | **改主题承载方式（类名 → 属性）时，这 4 个点 + `index.css:8` 的 `@custom-variant` + `:661` 的 `color-scheme` 必须同步**，共 6 处 |
| 3 | **`boot.js` 的解析顺序不能单独改**。它写的是**第一帧的真相**，与 `useResolvedAppearance` 的优先级必须逐字一致（`boot.js:4-6` 把这条写成了注释）。改一处必须改两处 |

---

## 1. 机制层面：为什么大多数情况下不需要写 `dark:`

### 1.1 四层结构（清单见 [`design-system-tokens.md`](./design-system-tokens.md) §1，此处只讲明暗）

| 层 | 位置 | 明暗怎么切 |
| --- | --- | --- |
| **A** `@theme inline` | `index.css:63-127` | 引用 B 层的**通道变量**（`hsl(var(--background))`），**自己不含明暗值** |
| **B** HSL 通道值 | `:root` `index.css:541-595` / `.dark` `:root` 内 `597-641` | **明暗就在这一层切**——同名变量在 `.dark` 上覆盖 |
| **C** `@theme` 直写色值 | `index.css:137-287`（**104 个** `--color-*`） | 手写的语义色，**部分**在 `.dark` 覆盖 |
| **D** `.dark` 覆盖 | `index.css:291-386`（**82 个**） | 覆盖 C 层里需要变的那些 |

**结论**：A 层 token（39 个 shadcn 语义色）**结构上天然双主题**——它们不含色值，只有引用。
所以 `bg-background` / `text-foreground` / `border-border` 这类**不需要写 `dark:`**。

### 1.2 B 层是"key 完全对齐"的（`[源码]`，可复现）

```bash
cd packages/console/source
diff <(sed -n '541,595p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort) \
     <(sed -n '597,641p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort)
# 无输出 = 两边 key 集合完全一致（各 39 个）
```

**这条 diff 干净**是"A 层不会出现单主题 token"的**结构性保证**：
只要 B 层的 key 集合一致，任何一个 A 层 token 在两种主题下都一定有值。
**这是每次改 B 层后必须重跑的第一条命令。**

### 1.3 C 层的 22 个未覆盖：全部有理由（`[源码]`）

```bash
cd packages/console/source
comm -23 \
  <(awk 'NR>=137 && NR<=287' styles/index.css | rg -o '^\s*--(color-[a-z0-9-]+):' -r '$1' | sort -u) \
  <(awk 'NR>=291 && NR<=386' styles/index.css | rg -o '^\s*--(color-[a-z0-9-]+):' -r '$1' | sort -u)
```

得到 **22 个**，可以**穷尽分类**成两组：

| 组 | 个数 | 成员 | 为什么不需要 `.dark` 覆盖 |
| --- | --- | --- | --- |
| **`--primary` 派生** | **13** | `components-button-primary-{bg,bg-hover,border,text}`、`components-option-card-option-selected-border`、`state-accent-{solid,hover,active}`、`text-accent`、`text-accent-secondary`、`workflow-block-border-highlight`、`workflow-link-line-{active,handle}` | 它们的值写成 `hsl(var(--primary))` 或 `hsl(var(--primary-foreground))`，而 **`--primary` 自己会切**（`:551` = `0 0% 9%` 亮 / `:606` = `0 0% 98%` 暗）→ **自动跟随** |
| **`util-colors-*`** | **9** | `blue-blue-500`、`blue-brand-blue-brand-500`、`cyan-cyan-500`、`green-green-500`、`indigo-indigo-500`、`pink-pink-500`、`violet-violet-500`、`warning-warning-500`、`yellow-yellow-500` | `index.css:265` 注释原文：**"util-colors：节点图标色块专用，明暗共用同一组值"**→ **有意共用**（色块上的前景固定白色，暗色下同样成立） |

**这两个分类是"未覆盖合不合理"的判定规则**，可以机械套用：

> **一个 C 层 token 没有 `.dark` 覆盖时，只有两种合法解释**：
> ① 它的值引用了会自己切的 B 层变量（在本文登记为"`--primary` 派生"）；
> ② 它属于 `index.css:265` 注释声明的"明暗共用"组（`util-colors-*`）。
> **其他任何理由都不是理由**——那就是漏了。

### 1.4 但组件里仍然有 56 处 `dark:`（`[源码]`）

```bash
cd packages/console/source
rg -o --no-filename '\bdark:' --glob '*.tsx' . | wc -l   # 29
rg -l '\bdark:' --glob '*.tsx' . | wc -l                 # 13 个文件
```

分布（按文件的 `dark:` 行数）：

| 文件 | 说明 |
| --- | --- |
| `components/ui/checkbox.tsx` | 5 |
| `components/ui/{input-group,radio-group}.tsx` | 各 4 |
| `components/ui/combobox.tsx`、`pages/router/components/workflow-node.tsx` | 各 3 |
| `components/ui/{switch}.tsx`、`pages/request-logs/components/request-contents-stage.tsx`（**搜索命中高亮**，见 §2.4） | 各 2 |
| 另外 6 个文件 | 各 1（`input` `chart` `calendar` `avatar` `rule-editor` `overview/page`） |

**这 29 处是本文要处理的第二套机制**——见 §2。

---

## 2. 两套机制：什么时候允许写 `dark:`

### 2.1 现状：token 与 `dark:` 是**并列存在**的

仓库同时有两条表达"暗色下不一样"的路径：

| 路径 | 形式 | 切换点 |
| --- | --- | --- |
| **token**（推荐） | `bg-components-input-bg-normal` | `styles/index.css` 的 `.dark` 块 |
| **变体**（现状 56 处） | `bg-input/30 dark:bg-input/20` | 组件里的 `dark:` 前缀 |

**为什么 token 更好**：token 的明暗值**并排放在同一个文件里**，一眼能看出"这一对是不是配错了"；
`dark:` 分散在 22 个组件里，**改一个语义要翻 22 个文件**，而且没有任何脚本能列出"全部明暗对"。

### 2.2 `dark:` 的四种实际用法（`[源码]` 归类）

| 用法 | 例 | 判定 |
| --- | --- | --- |
| **给 alpha 叠色补第二档** | `dark:bg-input/30`（7 处）、`dark:bg-input/20`、`dark:bg-amber-400/25` | **可以用**，但**应该收敛成 token**——`dark:bg-input/30` 出现 7 次，说明它是"凹槽底色"的一档，值得一个 token |
| **Radix 状态属性 × 明暗** | `dark:aria-invalid:*`（9 处）、`dark:data-checked:*`（4 处）、`dark:has-data-checked:*`（2 处）、`dark:data-unchecked:*` | **可以用**。状态属性是 Radix 给的（`data-checked` / `aria-invalid`），token 无法表达"仅在某个状态且暗色下"的交叉 |
| **调色板色 × 明暗** | `dark:border-amber-400/25`、`dark:bg-amber-400/{10,15,25,30}` | **不允许**——违反第 1 号铁律（视觉命名）。见 §2.4 |
| **结构性小覆盖** | `dark:bg-transparent`（2 处）、`dark:bg-accent`、`dark:hover:*`（3 处） | **逐条看**。多数是 shadcn 上游带下来的写法，要确认它对应的是哪个语义 token |

### 2.3 规则

| # | 规则 |
| --- | --- |
| 1 | **优先用 token**：能在 `.dark` 里覆盖的，就在 `.dark` 里覆盖 |
| 2 | **`dark:` 只允许用于"token 表达不了的交叉"**——即**同时**受一个 Radix 状态属性和明暗两个维度控制时（`dark:aria-invalid:*` / `dark:data-checked:*`）。这类**必须注释**说明为什么不能用 token |
| 3 | **同一个 `dark:` 写法出现 ≥3 次时，必须收敛成 token** | `dark:bg-input/30`（7 次）是当前最该收敛的一个。判据很简单：**写得多了就说明它是个语义，不是个例外** |
| 4 | **`dark:` 里不允许出现调色板类名**（`dark:bg-amber-400/*`）。调色板类名本身违规（[`design-system-tokens.md`](./design-system-tokens.md) §3.4 的 34 处），在 `dark:` 里违规两次——因为它同时引入了视觉命名和"明暗值散落在组件里" |
| 5 | **`dark:` 不允许嵌套任意值**（`dark:[…]` 4 处）——任意值本身要过 [`design-system-tokens.md`](./design-system-tokens.md) §3 的归位规则，在 `dark:` 里更难被发现 |

### 2.4 需要改的三处（登记，不在本文执行）

| 位置 | 现状 | 应改成 |
| --- | --- | --- |
| `pages/request-logs/components/request-contents-stage.tsx:121,145` | `bg-amber-300/70 … dark:bg-amber-400/25` / `dark:bg-amber-400/30` | 一组 token：`--color-search-hit-bg` + `--color-search-hit-bg-active`，明暗值都放 `.dark`。**这是"搜索命中高亮"这个真实 UI 状态，完全可以用 token 表达** |
| `pages/router/components/workflow-node.tsx:66` | `border-amber-300/70 bg-amber-50/80 … dark:border-amber-400/25 dark:bg-amber-400/10 dark:hover:bg-amber-400/15` | 登记 `workflow-node-note-*` 一组（[`design-system-tokens.md`](./design-system-tokens.md) §6 已列为候选）。**便签是节点状态，不是插图** |
| `components/ui/input*.tsx` 系列 | `dark:bg-input/30`（7 处） | 收敛成一个 token（凹槽底色的暗色档），或确认它属于 `--input` 的语义 |

---

## 3. 验证 checklist（可执行）

### 3.1 静态检查：三条命令，改完 B/C/D 层必跑

```bash
cd packages/console/source

# ① B 层 key 集合必须完全一致（无输出 = 通过）
diff <(sed -n '541,595p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort) \
     <(sed -n '597,641p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort)

# ② C 层未覆盖清单（应仍为 22 个，且每个都能归入 §1.3 的两类）
comm -23 \
  <(awk 'NR>=137 && NR<=287' styles/index.css | rg -o '^\s*--(color-[a-z0-9-]+):' -r '$1' | sort -u) \
  <(awk 'NR>=291 && NR<=386' styles/index.css | rg -o '^\s*--(color-[a-z0-9-]+):' -r '$1' | sort -u)

# ③ 组件里的 dark: 数量（不该增长；增长时逐条按 §2.3 判）
rg -o --no-filename '\bdark:' --glob '*.tsx' . | wc -l          # 当前 56
rg -c '\bdark:' --glob '*.tsx' . | sort -t: -k2 -rn             # 按文件
rg -n 'dark:(bg|text|border|ring)-(slate|gray|zinc|red|orange|amber|yellow|green|blue|indigo|violet|pink|rose)' --glob '*.tsx' .   # 应为空
```

**通过标准**：

| # | 检查 | 通过条件 |
| --- | --- | --- |
| ① | B 层 key diff | **无输出**。有输出 = 出现了"只在一种主题下存在"的 token，A 层引用它就是单主题，必须修 |
| ② | C 层未覆盖 | 数量**不增加**；新增的每一个都必须能归入 §1.3 的两类之一 |
| ③ | `dark:` 数量 | **不增加**；新增的每一条都要过 §2.3 规则 2（注释说明为什么 token 表达不了） |
| ③b | `dark:` + 调色板 | **输出为空**。非空即违规（§2.3 规则 4） |

### 3.2 逐 token 判定：新增一个 token 的明暗流程

**任何一个进入 `@theme` 的 `--color-*`，必须在这三步里选一步并写下来**：

```
新 token 的值是什么？
├─ hsl(var(--x))：引用会自己切的 B 层变量
│    → 不需要 .dark 覆盖。归入「--primary 派生」类（§1.3 组 ①）
├─ 明暗共用同一组值（如节点色块）
│    → 不需要 .dark 覆盖，但**必须写注释**说明"明暗共用"（照 index.css:265 的写法）
└─ 其他
     → **必须**在 .dark 里给出覆盖。给不出 → 这个 token 的设计有问题，
       因为它意味着"这个语义在暗色下没有对应值"
```

**这条流程是"覆盖完整"的算法**——只要每个 token 都走一遍，覆盖率就是 100%。
[`design-system-tokens.md`](./design-system-tokens.md) §7 的账（B 39 / C 104 / D 82 / 未覆盖 22）
就是这条算法的结果。

### 3.3 人工视觉检查：脚本查不出来的 11 项

静态检查只能证明"每个 token 都有明暗两个值"，**不能证明"两套都好看"**。
下面这些必须在暗色下逐项看过：

| # | 检查项 | 为什么脚本查不出来 | 线索 |
| --- | --- | --- | --- |
| 1 | **第一帧不闪** | 依赖 `boot.js` 与 React 的时序 | 冷启动时把系统主题切到暗，观察是否闪白光。**这是 `boot.js` 存在的唯一理由** |
| 2 | **滚动条** | 由 `color-scheme` 决定 | `::-webkit-scrollbar` 是自定义的（`index.css:687-695`），轨道色走 `hsl(var(--border))`；原生滚动条部分靠 `color-scheme` |
| 3 | **原生控件**：`<select>` 下拉 | 由 `color-scheme` 决定，不在 CSS 里 | 暗色下打开原生下拉，应为深色 |
| 4 | **表单控件的禁用态** | `disabled:opacity-50` 是 alpha 压暗（[`design-system-accessibility.md`](./design-system-accessibility.md) §1.4） | 暗色下压暗后可能"看不见"——不是"看不太清"，是**没有对比度** |
| 5 | **焦点环** | 5 种颜色写法（[`design-system-accessibility.md`](./design-system-accessibility.md) §3.2），其中 `ring-white/35` 在亮色下必然不可见 | 暗色下 `Tab` 一遍，看环是否都在 |
| 6 | **sticky 表头** | 用了 `bg-card/95 backdrop-blur-sm`（`logs-table.tsx:109`）或 `bg-inset`（`request-logs-table.tsx:98`） | 半透明 + 模糊的底色在暗色下若与表体接近，滚动时会"糊成一片" |
| 7 | **骨架屏** | `animate-pulse` 的透明度变化在暗色下的对比度不同 | 加载态在暗色下不能消失 |
| 8 | **浮层（portal）** | 部分浮层挂在 `body` 下、带 `workflow-ui-surface` 作用域（`index.css:818-841`），圆角与底色是**另一套值**（md 6 / lg 8 / xl 12 / 2xl 16） | 每个浮层都要在暗色下开一遍：下拉、Tooltip、Popover、Dialog、Sheet、Command |
| 9 | **导出物**：账单 PNG、打印机预览 | `html-to-image` 是 DOM 光栅化，**不克隆伪元素**（[`design-system-tokens.md`](./design-system-tokens.md) §3.2 已登记） | 导出一次，看图里的明暗是否与屏幕一致 |
| 10 | **`<html>` 类名的 2 个读取者**：`provider-icon.tsx`、`client-icon.tsx` | 它们用 `MutationObserver` 跟类名，**不看 React 状态** | 在设置页里切换主题，回头看模型管理页与客户端配置页的图标是否跟着换了 |
| 11 | **主题开关的 View Transition** | `animated-theme-toggler.tsx` 自己改类名（§0.3 第 3 个写点） | 用这个开关切换后，与用设置页切换对比，结果必须一致 |

### 3.4 一条容易漏的：`color-scheme` 与「跟随系统」

`ThemeMode` 的 `'system'` 是**偏好的第三个取值**，不是 `Theme` 的取值（§0.2）。
所以：

| # | 规则 |
| --- | --- |
| 1 | **改系统主题时，`'system'` 偏好的用户必须实时跟随**。`boot.js:38` 只处理第一帧；挂载后靠 `useResolvedAppearance` 的 `theme` |
| 2 | **告知宿主（Electron 主进程）时必须用 `effectiveThemeMode` 而不是 `theme`**。`use-appearance.ts` 的注释写明了理由：**"解析后的 `theme` 表达不了这件事——`dark` 可能是手选的，也可能是跟着系统来的"** |
| 3 | **暗色下 `<html>` 不能残留旧类**。`document-theme.test.tsx` 专门测了这一个：**"从暗切回亮时 `<html>` 会同时带 `ln` 与亮色变量，页面会花"**。虽然测试源码在阅读时受终端转义影响显示不全，但用例名说明了它守的是什么 |

---

## 4. 落地清单

**改任何 `styles/index.css` 的 token 时**：

- [ ] 跑了 §3.1 的三条命令
- [ ] 新增的 `--color-*` 走完了 §3.2 的三分支流程，并写下了它属于哪一支
- [ ] B 层没有加"只在一侧存在"的 key
- [ ] 新加的 `util-colors-*` 若确实明暗共用，**写了注释**（照 `index.css:265`）

**改任何组件样式时**：

- [ ] 能用 token 就不用 `dark:`
- [ ] 用了 `dark:` 就写了注释说明为什么 token 表达不了
- [ ] 没有引入 `dark:` + 调色板类名
- [ ] 没有引入 `dark:` + 任意值

**验主题时**：

- [ ] 跑 §3.1 的静态检查
- [ ] 过 §3.3 的 11 项人工检查（每项都做，不是抽样）
- [ ] 两个 HTML 入口（`index.html` / `tray.html`）都看过
- [ ] `'system'` 偏好下改系统主题，界面跟着变

---

## 5. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **`dark:` 各写法是否都有 shadcn 上游出处** | `[未核实]` | 56 处 `dark:` 里，`components/ui/*` 的多数看起来是 shadcn 模板带下来的，但**没有逐个与上游比对**。这决定了"哪些是有意设计、哪些是照抄" |
| **`dark:[…]` 4 处任意值的具体内容** | `[未核实]` | 统计到了数量（4 处），**没有逐处展开看**。它们可能包含必须保留的写法 |
| **`document-theme.test.tsx` 的实际用例数** | `[未核实]` | 用 `rg` 读该文件时输出被终端转义序列破坏（`document.documentElement` 显示为 `document.n`），**未能可靠读出全文**。本文只引用了能确认的用例语义（§3.4 规则 3） |
| **`--primary` 是否真的覆盖所有 13 个派生 token 的两种主题** | `[未核实]` | 本文确认了 13 个 token 的值都引用 `hsl(var(--primary))` 或 `--primary-foreground`，且 `--primary` 在两侧都有值（`:551` / `:606`）。但**没有逐个数值算过**暗色下的实际观感（如 `hsl(0 0% 98%)` 的 8% alpha 叠在暗底上是否够） |
| **托盘面板是否完整继承主题** | `[未核实]` | 它用**内存路由**（`use-appearance.ts` 注释），地址栏覆盖在窗口创建前由启动脚本读进 `<html>`。代码结构上应该一致，**但没有实际跑过托盘面板的暗色** |
| **`workflow-ui-surface` 作用域内的浮层是否有独立的 `.dark` 值** | `[未核实]` | `index.css:818-841` 只还原了圆角，**没有看它是否也还原了颜色**。若浮层在该作用域下用了不同的颜色 token，明暗行为需要单独核 |
| **导出图（账单 PNG）的明暗是否跟随当前主题** | `[未核实]` | 账单是固定配色的"票据"（`[源码]` 里它的色值全是字面量，见 tokens §3.2），**推测它不跟随主题**，但没有实测 |
