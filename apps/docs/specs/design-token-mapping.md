# 设计系统刻度映射：Carbon / Fluent 2 / Primer → osw 的 `@theme`

> 本文承接 [`design-system.md`](./design-system.md)（PR #123）的第二层——
> **「刻度与状态层 = 采用成熟系统的数值」**。
>
> 那份文档回答了「**借谁、借什么**」；这份回答「**借来的每一个数字，落在我们哪一档；我们缺哪一格**」。
> 它是映射表，不是迁移计划。
>
> **本文在整套文档里的位置**：上游数值的**唯一证据来源**。`[源码]` / `[文档]` / `[未核实]`
> 三档标签由本文 §0 定义，§8 是版本与抓取路径的**唯一登记处**，§9 是上游侧的未核实项。
> 各分册（[`design-system-tokens.md`](./design-system-tokens.md)、
> [`design-system-components.md`](./design-system-components.md)、
> [`design-system-accessibility.md`](./design-system-accessibility.md)、
> [`design-system-typography.md`](./design-system-typography.md)、
> [`design-system-icons.md`](./design-system-icons.md)、
> [`design-system-data-display.md`](./design-system-data-display.md)、
> [`design-system-copy.md`](./design-system-copy.md)、
> [`design-system-theming.md`](./design-system-theming.md)）**只引用本文的数值，不重复论证**；
> 它们各自末尾的「未核实」节只登记**本文没有覆盖的那些**。
> 文档地图见 [`design-system.md`](./design-system.md) §文档地图。

## 范围与不做什么

- 本文**只做映射与结论**：不改任何 token 的值、不动组件、不新增依赖、不碰 `styles/index.css`。
- 工作对象是 `packages/console/source/styles/index.css` 的 `@theme` 与 `components-*` 语义 token。
- issue #124 的第 4 项交付（真实页面的**规范符合度体检**）是独立交付物，**不在本文**。
- **本文不写入任何未经核实的数值**；核实不到的一律标 `[未核实]` 并列进 §9。

## 0. 证据规则

每个引用都带来源标签：

| 标签 | 含义 |
| --- | --- |
| `[源码]` | 从 npm 包或上游仓库文件读出的**原文**（本文的间距/字号/层级/控件高度全部是这一类） |
| `[文档]` | 上游官网文档页原文 |
| `[未核实]` | 抓不到、或上游已删除的概念——**不作为结论依据** |

版本与抓取路径见 §8。

---

## 1. osw 现状（实测基线）

以下全部由 `rg` 在 `packages/console/source` 上直接统计得出，可复现。

### 1.1 任意像素：78 处，按**属性**拆开才看得清问题

| 属性 | 处数 | 取值 | 备注 |
| --- | --- | --- | --- |
| 字号 `text-[Npx]` | 30 | 13px×25、12px×4、14px×1 | **最大的一类** |
| 圆角 `rounded-[Npx]` | 17 | 2px×6、5px×3、4px×3、15px×2、7px×1、24px×1、`rounded-br`3px×1 | 第二大类 |
| 模糊 `backdrop-blur-[Npx]` | 11 | 5px×11 | 唯一在用的模糊值 |
| 焦点环 `ring-[Npx]` | 4 | 3px×4 | 与 `focus-visible:ring-2` 冲突 |
| 真·间距/尺寸 | 13 | `p-[3px]`×2、`py-[2px]`、`left/right-[9px]`、`left/right-[21px]`、`w-[2px]`、`w-[24px]`、`w-[32px]`、`w-[100px]`、`h-[14px]`、`min-w-[96px]`、`min-w-[320px]` | 只有这一类是「间距问题」 |
| 其余（`blur-`） | 3 | 6px、30px | |

**结论（关键）**：78 处里 **47 处（60%）落在「离散刻度」上**——字号 30 + 圆角 17。
真正属于「间距越出刻度」的只有 **13 处**。这决定了下面两张表的处置方式完全不同。

### 1.2 `@theme` 现状

| 项 | 现状 |
| --- | --- |
| `--spacing-*` | **0 个**——完全依赖 Tailwind v4 的 `--spacing: 0.25rem` 动态刻度 `[源码]` |
| `--text-*` | **1 个**：`--text-2xs: 0.6875rem`（11px，且注释明确写「11px 是字号下限」） |
| `--shadow-*` | **0 个**——`styles/index.css:194` 注释 + `workflow-node.tsx` / `block-icon.tsx` 注释三处都写明「本仓库偏好不用阴影」 |
| `--radius-*` | 由单一 `--radius: 0.375rem`(6px) 派生 sm 2 / md 4 / lg 6 / xl 10px，另有 2xl≈10.8 / 3xl≈13.2 / 4xl≈15.6px |
| `components-button-*` | 3 档 × (bg, bg-hover, text) + 边框/hover 边框；另有 ghost / destructive-ghost 两个文本档 |
| z 层 | **无语义 token**，类名散落：`z-10`×34、`z-50`×29、`z-0`×9、`z-30`×4、`z-20`×4、`z-70`×2、`z-1`×2、`z-40`×1 |

### 1.3 实际在用的字号（按类名统计）

| 类 | 处数 | 实际字号 |
| --- | --- | --- |
| `text-sm` | 68 | 14px（Tailwind 默认） |
| `text-xs` | 42 | 12px |
| `text-base` | 12 | 16px |
| `text-2xs` | 4 | 11px（osw 自定义） |
| `text-2xl` | 2 | 24px |
| `text-[13px]` | 25 | **13px（任意值）** |

另有 osw 自己的实用类阶梯 `system-{2xs,xs,sm,md,xl}-*`（`styles/index.css:391` 起）：
**11 / 12 / 13 / 14 / 16 px**，行高 16 / 16 / 16 / 20 / 24px。注意 `system-sm-*` 就是 **13px**。

### 1.4 实际在用的控件高度

`h-8`×51、`h-9`×15、`h-7`×13、`h-11`×8、`h-10`×5、`h-12`×1；
按钮自身的尺寸档（`button.tsx`）：`xs` h-6(24) / `sm` h-7(28) / `default` h-8(32) / `lg` h-9(36) / `icon*` size-6/7/8/9。

---

## 2. 间距刻度：Carbon `spacing-01..13` → osw

### 2.1 Carbon 的 13 档（`[源码]`）

来源：`@carbon/layout@11.62.0` → `js/generated/layout-tokens.js`、`scss/generated/_spacing.scss`。

| Carbon | 值 | | Carbon | 值 |
| --- | --- | --- | --- | --- |
| `spacing-01` | 0.125rem = **2px** | | `spacing-08` | 2.5rem = **40px** |
| `spacing-02` | 0.25rem = **4px** | | `spacing-09` | 3rem = **48px** |
| `spacing-03` | 0.5rem = **8px** | | `spacing-10` | 4rem = **64px** |
| `spacing-04` | 0.75rem = **12px** | | `spacing-11` | 5rem = **80px** |
| `spacing-05` | 1rem = **16px** | | `spacing-12` | 6rem = **96px** |
| `spacing-06` | 1.5rem = **24px** | | `spacing-13` | 10rem = **160px** |
| `spacing-07` | 2rem = **32px** | | | |

### 2.2 映射表：Carbon 13 档 → Tailwind 动态刻度

Tailwind v4 的间距是 `--spacing: 0.25rem` 的**动态倍数刻度**（`p-<number>` 即 `number × 4px`）`[源码]`。

| Carbon | 值 | Tailwind 类 | 有档？ |
| --- | --- | --- | --- |
| `spacing-01` | 2px | `*-0.5` | ✅ |
| `spacing-02` | 4px | `*-1` | ✅ |
| `spacing-03` | 8px | `*-2` | ✅ |
| `spacing-04` | 12px | `*-3` | ✅ |
| `spacing-05` | 16px | `*-4` | ✅ |
| `spacing-06` | 24px | `*-6` | ✅ |
| `spacing-07` | 32px | `*-8` | ✅ |
| `spacing-08` | 40px | `*-10` | ✅ |
| `spacing-09` | 48px | `*-12` | ✅ |
| `spacing-10` | 64px | `*-16` | ✅ |
| `spacing-11` | 80px | `*-20` | ✅ |
| `spacing-12` | 96px | `*-24` | ✅ |
| `spacing-13` | 160px | `*-40` | ✅ |

**缺档：0。** Carbon 的 13 档全部能用 Tailwind 动态刻度表示，**不需要新增 `--spacing-*`**。

**「多余」的档**：Tailwind 动态刻度还包含 Carbon 没有的档位——
`0`（`*-0`）、非 4px 倍数（`*-0.5`=2px、`*-1.5`=6px、`*-2.5`=10px、`*-3.5`=14px）。
这些**不是缺陷**，但要限定用途，否则就会出现「5px / 3px / 9px」这种即兴值：

| 多余档 | 值 | 允许的用途 |
| --- | --- | --- |
| `*-0.5` | 2px | 仅允许用于 **1px 视觉缝隙**（图标与文字的贴合、描边内缩）与 1px 边框的视觉补偿 |
| `*-1.5` | 6px | 仅允许用于图标与段落的水平间隙 |
| `*-2.5` / `*-3.5` | 10 / 14px | **不允许**用于布局间距；只允许出现在图标尺寸（`size-2.5` / `size-3.5`）上 |

### 2.3 78 处任意像素的归位表

| 任意值 | 处数 | 实测用途 | 归位 | 说明 |
| --- | --- | --- | --- | --- |
| `[13px]` | 25 | 字号（`text-[13px]`） | → **§3 的 13px 档** | 不是间距问题 |
| `[5px]` | 14 | 模糊（`backdrop-blur-[5px]`×11）+ 圆角 `rounded-[5px]`×3 | 模糊 → §5 的浮层模糊 token；圆角 5 → `rounded-md`(4px) | 5px 不在 Carbon 任何一档 |
| `[2px]` | 8 | `rounded-[2px]`×6 + `w-[2px]` + `py-[2px]` | 圆角 → `rounded-sm`(2px) ✅；间距 → `*-0.5` ✅（= Carbon `spacing-01`） | **有现成档** |
| `[3px]` | 7 | `ring-[3px]`×4 + `p-[3px]`×2 + `rounded-br-[3px]`×1 | 焦点环 → 统一到 2px（Primer 焦点环宽度 `[源码]`）；`p-[3px]` → `p-0.5` 或 `p-1` | 3px 无档 |
| `[12px]` | 4 | 字号 `text-[12px]` | → `text-xs`（12px，已有） | 直接改名 |
| `[4px]` | 3 | `rounded-[4px]` | → `rounded-md`(4px) ✅ | 有现成档 |
| `[9px]` | 2 | `left-[9px]` / `right-[9px]` | → `*-2`(8px) 或 `*-2.5`(10px) | 9px 无档，归 8px |
| `[24px]` | 2 | `rounded-[24px]` + `w-[24px]` | 宽 → `w-6` ✅（= Carbon `spacing-06`）；圆角 24 → 见 §6 | |
| `[21px]` | 2 | `left-[21px]` / `right-[21px]` | → `*-5`(20px) | 21px 无档，归 20px |
| `[15px]` | 2 | `rounded-[15px]` | → `rounded-4xl`(15.6px) 或补档 | 离散圆角缺档 |
| `[14px]` | 2 | `h-[14px]` + `text-[14px]` | `h-3.5`(14px) ✅；字号 → `text-sm`(14px) | 有现成档 |
| `[7px]` `[6px]` `[96px]` `[32px]` `[30px]` `[100px]` `[320px]` | 各 1 | 圆角 / `min-w-[96px]` / `w-[32px]` / 模糊 / `w-[100px]` / `min-w-[320px]` | 96 → `min-w-24` ✅；32 → `w-8` ✅；100 → `w-25` ✅；320 → `w-80` ✅ | **全部有动态档** |

**间距部分的结论**：**没有缺档**。13 处真·间距**全部**能用已有的动态刻度归位（`0.5 / 1 / 2 / 3 / 3.5 / 6 / 8 / 24 / 25 / 80`）。
真正的缺口在**离散刻度**（字号、圆角）上，见 §3 与 §6。

---

## 3. 字号阶梯：Carbon Type Set / Fluent ramp / Primer → osw

### 3.1 三家上游的字号（`[源码]`）

**Carbon**：`@carbon/type@11.70.0` → `scss/_scale.scss` 的 `$type-scale` 由公式生成，step1=12px 起、递增到 92px：

| step | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| px | 12 | 14 | 16 | 18 | 20 | 24 | 28 | 32 | 36 | 42 | 54 |

命名档（`scss/_styles.scss`，step 为实测）：`label-01`/`helper-text-01`/`code-01`/`caption-01` = **12**；
`body-01`/`heading-01`/`code-02`/`caption-02` = **14**；
`body-02`/`heading-02` = **16**；`productive-heading-03` = **20**；`04` = **28**；`05` = **32**；`06` = **42**；`07` = **54**。

**Fluent 2**：`@fluentui/tokens@1.0.0-alpha.24` → `lib/global/fonts.js`：

| token | px / 行高 |
| --- | --- |
| `fontSizeBase100`（caption2） | 10 / 14 |
| `fontSizeBase200`（caption1） | **12** / 16 |
| `fontSizeBase300`（body1） | **14** / 20 |
| `fontSizeBase400`（body2 / subtitle2） | **16** / 22 |
| `fontSizeBase500`（subtitle1） | **20** / 28 |
| `fontSizeBase600`（title3） | **24** / 32 |
| `fontSizeHero700`（title2） | 28 / 36 |
| `fontSizeHero800`（title1） | 32 / 40 |
| `fontSizeHero900`（largeTitle） | 40 / 52 |
| `fontSizeHero1000`（display） | 68 / 92 |

**Primer**：`@primer/primitives@11.10.0` → `src/tokens/base/typography/typography.json5`：
`xs` 12 / `sm` 14 / `md` 16 / `lg` 20 / `xl` 32 / `2xl` 40。

### 3.2 现状落档与缺口

osw 能用的档 = Tailwind 默认 `--text-*` `[源码]`（xs 12 / sm 14 / base 16 / lg 18 / xl 20 / 2xl 24 …）**+** osw 自己的 `--text-2xs`(11)。

| osw 档 | px | 现状用例 | Carbon | Fluent | Primer |
| --- | --- | --- | --- | --- | --- |
| `text-2xs` | **11** | 4 | ✗（Carbon 最小 12） | ✗（最接近 caption2 = 10） | ✗（最小 12） |
| `text-xs` | **12** | 42 | `label-01` = 12 | `caption1` = 12 | `xs` = 12 |
| **（缺）** | **13** | 25 处 `text-[13px]` + `system-sm-*` | ✗ | ✗ | ✗ |
| `text-sm` | **14** | 68 | `body-01` = 14 | `body1` = 14 | `sm` = 14 |
| `text-base` | **16** | 12 | `heading-02` = 16 | `body2` = 16 | `md` = 16 |
| `text-xl` | **20** | 0（可用） | `productive-heading-03` = 20 | `subtitle1` = 20 | `lg` = 20 |
| `text-2xl` | **24** | 2 | ✗（下一档 28） | `title3` = 24 | ✗（`xl` = 32） |

**缺口只有一格：13px。** 而且这一格是**三家成熟系统都没有的**——
Carbon 从 12 直接跳 14，Fluent/Primer 同样没有 13。
它却在我们这里是**第三高频**（25 处任意值 + 整套 `system-sm-*` 实用类 + 按钮根字号）。

**行高**不需另立：Tailwind 默认行高（12→16、14→20、16→24）与 osw `system-*` 实用类的行高**逐档一致**，13px 应取 16px（与 11/12 同一条 16px 基线，见 `index.css:391` 的注释理由）。

### 3.3 建议的 `--text-*` 阶梯

**不重定义 Tailwind 已有的名字**（否则 68 处 `text-sm`、12 处 `text-base` 会静默漂移），只补缺的那一格：

| token | size / 行高 | 来源 | 处置 |
| --- | --- | --- | --- |
| `--text-2xs` | 11 / 16 | osw 品牌层（上游 10 → 11，注释已说明理由） | 保留 |
| `--text-xs` | 12 / 16 | Tailwind 默认 = Carbon `label-01` = Primer `xs` = Fluent `caption1` | 保留 |
| `--text-compact` | **13 / 16** | **osw 品牌层——三家都没有** | **新增**，见 §7 |
| `--text-sm` | 14 / 20 | Tailwind 默认 = Carbon `body-01` = Primer `sm` = Fluent `body1` | 保留 |
| `--text-base` | 16 / 24 | Tailwind 默认 = Carbon `heading-02` = Primer `md` = Fluent `body2` | 保留 |
| `--text-xl` | 20 / 28 | Tailwind 默认 = Carbon `productive-heading-03` = Primer `lg` | 保留，按需使用 |
| `--text-2xl` | 24 / 32 | Tailwind 默认 ≈ Fluent `title3` | 保留 |

> 命名「compact」而不是「13px」：延续仓库既有的**用途语义**约定。
> 实测 25 处 `text-[13px]` 全部出现在**控件与浮层**里（按钮根字号、菜单项、Popover/Dropdown 内容），
> 所以 13px 的语义就是「紧凑控件文本」。
>
> **备选方案（不推荐，登记备查）**：把 Tailwind 的 `--text-sm` 直接覆盖成 13px。
> 代价是把 68 处 `text-sm` 从 14px 拉到 13px，属于一次独立的视觉迁移，**不应夹在这份映射里做**。

---

## 4. 密度：Fluent control height / Carbon size → osw 控件高度

### 4.1 上游的控件高度

**Primer**（`[源码]`，`src/tokens/functional/size/size.json5`）——**唯一把控件高度写成 token 的一家**：

| 档 | 高度 | 说明 |
| --- | --- | --- |
| `control.xsmall` | **24px** | 密集 UI |
| `control.small` | **28px** | 密集 UI |
| `control.medium` | **32px** | 标准表单 |
| `control.large` | **40px** | 强调 CTA |
| `control.xlarge` | **48px** | 强调 CTA |
| `control.minTarget.fine` | **16px** | 细指针（鼠标）最小可点 |
| `control.minTarget.coarse` | **44px** | 粗指针（触控）最小可点 |

**Carbon**（`[源码]`，`@carbon/layout@11.62.0`）：没有「控件高度」token，只有通用尺寸刻度
`size-xs` 24 / `size-sm` 32 / `size-md` 40 / `size-lg` 48 / `size-xl` 64 / `size-2xl` 80px；
`@carbon/react` v11 用**组件的 `size` prop** 表达密度（v10 的 `short/medium/tall` 三档在 `carbon@main` 源码里已无对应 token，见 §9）。

**Fluent 2**：`@fluentui/tokens` 里**没有**控件高度 token（`lib/global/fonts.js`、`spacings.js` 均无 `controlHeight` 一类键）。
Fluent v9 的按钮高度由 `spacing + lineHeight` 合成（`react-button/library/.../useButtonStyles.styles.ts` 实测），不是固定 token。
官网常见的 24 / 32 / 40 三档 `[未核实]`——抓不到可文本化的数值页，见 §9。

### 4.2 osw 的 h-* 各对应什么密级

| osw 类 | 高度 | 处数 | 对应成品档 | 判定 |
| --- | --- | --- | --- | --- |
| `h-6` | 24px | （按钮 `xs`） | Primer `xsmall` = 24 | ✅ 最紧凑档 |
| `h-7` | 28px | 13 | Primer `small` = 28 | ✅ 紧凑档 |
| `h-8` | 32px | **51** | Primer `medium` = Fluent 中 / Carbon `size-sm` = **32** | ✅ **标准档（默认）** |
| `h-9` | 36px | 15 | **无任何一家有 36px**（Carbon 是 32→40） | ⚠️ **半档，需归并** |
| `h-10` | 40px | 5 | Primer `large` / Carbon `size-md` = 40 | ✅ 宽松档 |
| `h-11` | 44px | 8 | **不是控件高度**，是 Primer `minTarget.coarse`（触控最小可点） | ⚠️ 语义被误用 |
| `h-12` | 48px | 1 | Primer `xlarge` / Carbon `size-lg` = 48 | 大档（仅 1 处，可归 40） |

### 4.3 桌面产品该收敛成几档

osw 是**桌面单窗口应用**，指针是鼠标（Primer 的 fine pointer 分支），所以：

**建议 3 档 + 1 个触控下限：**

| 档 | 高度 | 用途 | 依据 |
| --- | --- | --- | --- |
| 紧凑 | **28px** | 工具条、表格行内操作、菜单项（`h-7`） | Primer `small` |
| 标准 | **32px** | 表单控件与默认按钮（`h-8`，与 `Input` / `Select` 对齐） | Primer `medium` = Fluent 中 = Carbon `size-sm` |
| 宽松 | **40px** | 页面级主操作、空状态 CTA（`h-10`） | Primer `large` = Carbon `size-md` |
| （触控下限） | **44px** | **只在粗指针媒体查询下作为最小可点区域**，不作控件高度 | Primer `minTarget.coarse` |

**归并动作**（本文只给结论）：
- `h-9`(36px, 15 处) → 归 **32px**（并入标准档，表单行以 32 为主）或 40px；36 不在任何成熟系统的格子上。
- `h-11`(44px, 8 处) → 复核是否为「误当控件高度」；若是触控目标用途，应写成 `min-h-11` 并限定在粗指针分支。
- `h-12`(48px, 1 处) → 归 40px。
- 24px 档保留，只给图标按钮（`icon-xs`）与表格行内极小操作。

---

## 5. 层级 elevation：Fluent elevation / Carbon layering → osw

### 5.1 上游的层级模型

**Fluent 2**（`[源码]`，`lib/utils/shadows.js`）——**阴影档位名就是「层级深度」**，把 shadow 与 z 层绑在一起：

| depth | 阴影（原文结构） |
| --- | --- |
| `shadow2` | `0 0 2px ambient, 0 1px 2px key` |
| `shadow4` | `0 0 2px ambient, 0 2px 4px key` |
| `shadow8` | `0 0 2px ambient, 0 4px 8px key` |
| `shadow16` | `0 0 2px ambient, 0 8px 16px key` |
| `shadow28` | `0 0 8px ambient, 0 14px 28px key` |
| `shadow64` | `0 0 8px ambient, 0 32px 64px key` |

`[文档]` Fluent 官方原文（`ElevationDepth.md`）：
> Depth (also referred to as elevation) is used to draw focus to an experience and add a physical materiality to the app.
> Shallow levels are reserved for items that are closely connected to the canvas or view, such as tiles.
> Deeper levels create a prominent frame around the surface, drawing strong focus to self-contained experiences like dialogs.

**Primer**（`[源码]`，`src/tokens/functional/shadow/shadow.json5`）：把阴影按**用途**分两组，
`resting.{xsmall,small,medium}`（静止表面）与 `floating.{small,medium,large,xlarge}`（浮层），
并在 `z-index.json5` 里把 z 与语义绑定：`sticky` 100 / `dropdown` 200 / `overlay` 300 / `modal` 400 / `popover` 500 / `skipLink` 600。

**Carbon**（`[文档]` 概念）：用 `layer-01/02/03` 与 `field-01/02/03` 的**明度台阶**分层，不靠阴影。

### 5.2 osw 浮层实况（实测）

| 浮层 | 现状实现 |
| --- | --- |
| Popover / DropdownMenu / ContextMenu / Menubar / Select / Combobox | `shadow-none` + `border-[0.5px] border-components-panel-border` + `bg-components-panel-bg-blur`（`rgb(255 255 255 / 0.95)`）+ `backdrop-blur-[5px]` |
| Tooltip | 同一套（`shadow-none` + 0.5px 边框 + 模糊） |
| Dialog / AlertDialog | 内容 `bg-popover`，**无阴影**；遮罩 `bg-black/10` + `backdrop-blur-xs` |
| Sheet / Drawer / Toast | 无阴影 |

实测 `shadow-*` 共 32 处，其中 **`shadow-none` 18 处**是**显式抑制**；
非 `none` 的 14 处（`shadow-md` 7 / `shadow-lg` 4 / `shadow-sm` 2 / `shadow-xl` 1）**集中在 shadcn 默认残留**上
（`sidebar` 的 floating 变体、`hover-card`、`chart` 的 tooltip、`context-menu`、`menubar`、`navigation-menu` 的箭头），
**不是一套有意的 elevation 体系**——本仓库自己写的三处注释（`index.css:194`、`workflow-node.tsx:23`、`block-icon.tsx:11`）都写明「偏好不用阴影，层级改由明度台阶承担」。

### 5.3 结论：保持无阴影，但补 z 层

**论证（为什么该保持无阴影）：**

1. **分层机制已经成立**。osw 用的是 **0.5px 边框 + 半透明模糊底 + 明度台阶**（`sidebar < background < card/popover`），
   与 **Carbon 的 layering 同向**——用明度而非投影表达层。
2. **桌面单窗口下投影的收益最低**。浮层永远落在同一个窗口内，背景可预测，
   Fluent 的 elevation 要解决的是「面板浮在窗口/多窗口之上」的材质感，我们没有这个问题。
3. **投影的跨平台成本最高**。无合成器 / 远程桌面的 Windows、Linux 环境里，
   大半径阴影容易退化成色块或直接丢失，反而破坏层次。

**但确实缺一样东西：z 层没有任何语义 token。**
实测 `z-10 / 20 / 30 / 40 / 50 / 70 / 0 / 1` 混用，浮层靠「记住 `z-50`」而不是靠语义。
Primer 的做法（z 与语义绑定）直接适用——**这是比阴影更该补的缺口**，见 §7。

**最小必要阴影（登记为「当前不采用」，供未来跨窗口场景）**：若要引入，只上 2 档，映射如下表；
采用前必须同时在 `.dark` 里给出暗色覆盖（亮色投影在暗色底上不可见）。

| 建议 token | 结构 | 对应 | 用途 |
| --- | --- | --- | --- |
| `--shadow-overlay-resting` | Fluent `shadow8` | Primer `floating.small` / `floating.medium` | Tooltip / Dropdown / Popover |
| `--shadow-overlay-floating` | Fluent `shadow28` | Primer `floating.large` | Dialog / Sheet / Toast |

---

## 6. 状态矩阵完备性：Primer button 状态网格 → osw 缺口

### 6.1 Primer 的网格（`[源码]`，`src/tokens/component/button.json5`）

Primer 把按钮状态写成**死网格**：

- **变体 6 个**：`default` / `primary` / `invisible` / `outline` / `danger` / `inactive`
- **状态 5 个**：`rest` / `hover` / `active` / `selected` / `disabled`
- **通道 4~5 个**：`fgColor` / `iconColor` / `bgColor` / `borderColor`（+ `shadow`，含 `resting` / `selected`）

即 **每个变体约 18~20 个格子**。焦点态不在组件 token 里，而是全局 `focus.json5`：
`outline: 2px solid {borderColor.accent.emphasis}`、`width: 2px`、`offset: -2px`（`[源码]`）。

### 6.2 osw 现状

| 变体 | rest | hover | active | focus-visible | disabled | loading | selected |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `primary`（`default`） | ✅ bg/text/border | ✅ bg-hover | ❌ | ⚠️ `ring-state-accent-solid` | ⚠️ `opacity-50` | ❌ | ❌ |
| `secondary`（`outline`） | ✅ bg/text/border | ✅ bg-hover + border-hover | ❌ | ⚠️ 同上 | ⚠️ `opacity-50` | ❌ | ❌ |
| `tertiary`（`secondary`） | ✅ bg/text | ✅ bg-hover | ❌ | ⚠️ 同上 | ⚠️ `opacity-50` | ❌ | ❌ |
| `ghost` | ✅ text | ✅ bg-hover | ❌ | ⚠️ 同上 | ⚠️ `opacity-50` | ❌ | ❌ |
| `destructive` | ⚠️ `bg-destructive/10`（**用 alpha 叠语义色，不是 components token**） | ⚠️ `hover:bg-destructive/20` | ❌ | ⚠️ `ring-destructive/20`（与其余变体写法不一致） | ⚠️ `opacity-50` | ❌ | ❌ |

（`✅` 有显式 token；`⚠️` 有实现但**不是 token**，且明暗两套不独立；`❌` 完全缺失。）

### 6.3 缺失的格子（清单）

| # | 缺的格子 | 涉及变体 | 现状替代 | 问题 |
| --- | --- | --- | --- | --- |
| 1 | `bg-active`（按下态） | 全 5 个 | `active:translate-y-px`（位移） | 用几何位移代替颜色反馈，与 `h-*` 档位无关时会产生抖动 |
| 2 | `bg-disabled` | 全 5 个 | `disabled:opacity-50` | **alpha 压暗会同时改变前景/背景对比度**，明暗两套无法各自校正 |
| 3 | `text-disabled` | 全 5 个 | 同上 | 同上 |
| 4 | `border-disabled` | `primary` / `secondary` | 同上 | 同上 |
| 5 | `focus-ring`（按变体） | 全 5 个 | 统一 `ring-state-accent-solid`（destructive 例外用 `/20` 透明度） | 焦点环颜色不随变体语义走；宽度还与 4 处 `ring-[3px]` 冲突 |
| 6 | `loading` | 全 5 个 | 无（`spinner` 组件存在但 Button 无 loading 契约） | 提交类操作只能用 disabled 表达 |
| 7 | `selected` / `aria-pressed` | 全 5 个 | 无（`aria-expanded` 借用了 bg-hover） | 切换类按钮没有选中态 token |
| 8 | `icon-color`（独立于 text） | 全 5 个 | 图标继承 `text` | Primer 把 icon 与 text 分开；我们的图标在浅色按钮上无法单独调 |

**共约 23 个格子**（5 变体 × 3 通道 disabled = 15，+ 5 active，+ focus/loading/selected）。
其中**最该先补的三组**：`disabled`（3 通道）、`active`、`focus-ring`。
`loading` 建议**复用 disabled 的视觉**（不新增色值），只补一个 loading 契约。

---

## 7. 新增 token 清单

只列**确实需要新增**的。每条说明「为什么现有档位不够」。

### 7.1 字号（1 个）

| token | 值 | 层 | 为什么现有档位不够 |
| --- | --- | --- | --- |
| `--text-compact` | `0.8125rem`(13px) / 行高 16px | 品牌层（密度手感） | Tailwind 的 `xs`(12) 偏低、`sm`(14) 偏高，**13px 这一格三家成熟系统都没有**（Carbon 12→14 直跳）；而它是我们第三高频字号（25 处任意值 + 整套 `system-sm-*` + 按钮根字号），且行高恰好落在已有 16px 基线上 |

### 7.2 层级（1 个）

| token | 值 | 层 | 为什么现有档位不够 |
| --- | --- | --- | --- |
| `--blur-panel` | `5px` | 品牌层 | 浮层的毛玻璃是当前**唯一的浮层分离手段**（配合 0.5px 边框），但 11 处都写成 `backdrop-blur-[5px]`，没有名字；改一次模糊强度要动 11 个文件 |

### 7.3 z 层（6 个，语义命名，对照 Primer `[源码]`）

| token | 值 | 对应 Primer |
| --- | --- | --- |
| `--z-sticky` | 100 | `zIndex.sticky` |
| `--z-dropdown` | 200 | `zIndex.dropdown` |
| `--z-overlay` | 300 | `zIndex.overlay` |
| `--z-modal` | 400 | `zIndex.modal` |
| `--z-popover` | 500 | `zIndex.popover` |
| `--z-skip-link` | 600 | `zIndex.skipLink` |

**为什么现有档位不够**：实测 `z-10/20/30/40/50/70/0/1` 八种取值散落在组件里，浮层靠 `z-50` 这个魔数维持顺序；
Primer 已经把 z 与语义绑定，我们照抄档位即可——**这是比阴影更该补的缺口**。

### 7.4 状态（按需，先补三组）

| token 组 | 通道 | 为什么现有档位不够 |
| --- | --- | --- |
| `--color-components-button-{primary,secondary,tertiary,ghost,destructive}-bg-active` | bg | 5 个变体全缺按下态；现用 `active:translate-y-px` 的几何位移代替，是行为层的越权实现 |
| `--color-components-button-*-{bg,text,border}-disabled` | bg / text / border | 现用 `disabled:opacity-50` 全局压暗；**alpha 压暗不是 token**，会让明暗两套的对比度关系无法独立校正（对比 §2 `--color-components-input-*-disabled` 已有 4 个独立 token） |
| `--color-components-button-focus-ring` + `--focus-ring-width: 2px` | ring | 现用 `ring-state-accent-solid`（destructive 例外用 `ring-destructive/20`），写法不统一；宽度还被 4 处 `ring-[3px]` 绕过。Primer 的全局焦点环是 `2px solid accent`、offset `-2px` `[源码]` |

### 7.5 明确**不**新增

| 项 | 理由 |
| --- | --- |
| `--spacing-*` | Tailwind 动态刻度已是 Carbon 13 档的超集，13 处真·间距全部可归位（§2.3） |
| `--shadow-*` | 本仓以明度台阶分层（同向 Carbon layering），保持无阴影（§5.3） |
| 新圆角刻度 | 圆角已由单一 `--radius` 派生；任意值里的 3/5/7px 应**归位**到 sm/md/lg，而不是补偿刻度 |
| 新的颜色体系 | 品牌层色值只允许存在于 `@theme`，且必须语义命名——不因这份映射新增任何视觉命名色 |

---

## 8. 证据来源

| 来源 | 版本 / 路径 | 用于 |
| --- | --- | --- |
| `@carbon/layout` | `11.62.0` → `js/generated/layout-tokens.js`、`scss/generated/_spacing.scss` | `spacing-01..13` 全部数值、`size-*`、`borderRadius*` |
| `@carbon/type` | `11.70.0` → `scss/_scale.scss`、`scss/_styles.scss` | `$type-scale` 公式与命名档 |
| `carbon`（仓库） | `packages/themes/src/tokens/layout.ts`（`main`） | `spacing-01..13` 的 token 名清单 |
| `@fluentui/tokens` | `1.0.0-alpha.24` → `lib/global/{fonts,spacings,durations,borderRadius}.js`、`lib/utils/shadows.js`、`lib/global/typographyStyles.js` | Fluent 字号/行高/间距/阴影 depth/时长/圆角 |
| `fluentui`（仓库） | `apps/public-docsite/src/pages/Styles/ElevationPage/docs/web/ElevationDepth.md`（`master`） | elevation 与「深度」的官方定义 |
| `@primer/primitives` | `11.10.0` → `src/tokens/{base/size/size.json5, base/typography/typography.json5, functional/size/size.json5, functional/size/z-index.json5, functional/size/radius.json5, functional/shadow/shadow.json5, component/button.json5, component/focus.json5}` | 控件高度、字号、z 层、圆角、阴影、按钮状态网格、焦点环 |
| `tailwindcss`（仓库） | `packages/tailwindcss/theme.css`（`main`） | `--spacing: 0.25rem`、`--text-*`、`--radius-*`、`--shadow-*` 默认值 |
| `osw`（本仓） | `packages/console/source/**` | §1 全部计数与 §5.2 浮层实况 |

计数命令（可复现）：

```bash
cd packages/console/source
rg -o --no-filename "\[[0-9]+px\]" --glob '*.tsx' --glob '*.ts' . | sort | uniq -c | sort -rn
rg -o --no-filename "text-(2xs|xs|sm|base|lg|xl|2xl)" --glob '*.tsx' . | sort | uniq -c | sort -rn
rg -o --no-filename "shadow-(none|sm|md|lg|xl|2xl)" --glob '*.tsx' . | sort | uniq -c | sort -rn
rg -o --no-filename "\bh-(7|8|9|10|11|12)\b" --glob '*.tsx' . | sort | uniq -c | sort -rn
```

---

## 9. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **Fluent 2 的控件高度（24 / 32 / 40）** | `[未核实]` | `@fluentui/tokens` 里没有控件高度 token（已逐个包内检索 `controlHeight` / `Height`，无命中）；Fluent v9 按钮高度由 `spacing + lineHeight` 合成；官网数值页是 JS 渲染，抓不到可文本化的原文。**§4 的成品档只引用了 Primer（有 token）与 Carbon（有 size 刻度）** |
| **Carbon 的 `short / medium / tall` 密度三档** | `[未核实]` | `carbon@main` 的 `packages/styles/scss` 与 `packages/carbon-components/scss` 里都**没有** `density` 相关文件；该三档是 v10 的旧概念，现行 v11 用组件 `size` prop 代替。§4 未把它当依据 |
| **Carbon layering 的官方页原文** | `[未核实]` | `carbon-website` 仓库与 sitemap 里找不到固定的 density / layering 文档路径（站点已迁到 CMS）。§5.1 只写「明度台阶分层」这一概念，未引用具体 URL |
| **Primer `floating.{small,medium,large,xlarge}` 的精确数值** | 部分核实 | 档位名、用途与 `floating.small` 的三层结构（`0 0 0 1px α0.25` / `0 6 12 -3 α0.04` / `0 6 18 0 α0.12`）已核实；`medium/large/xlarge` 只核实了档位与用途，未逐值抄录（JSON5 的嵌套结构未做全量解析） |

---

## 附：给评审用的速查

| 问题 | 结论 |
| --- | --- |
| 间距要新增 `--spacing-*` 吗 | **不要**。Carbon 13 档全在 Tailwind 动态刻度内，缺档 0 |
| 78 处任意像素该怎么收 | 47 处是字号+圆角（离散刻度问题），13 处真·间距**全部**可归位到现有动态档 |
| 字号缺哪一档 | **只缺 13px**，且三家成熟系统都没有这一档 → 新增 `--text-compact`（品牌层） |
| 桌面密度收敛成几档 | **3 档**（28 / 32 / 40）+ 44px 触控下限；`h-9`(36) 是半档，需归并 |
| 要不要上投影 | **不要**。与 Carbon layering 同向；但 z 层要补 6 个语义 token |
| 状态矩阵缺几格 | 约 **23 格**；先补 `disabled`(3 通道) / `active` / `focus-ring` |
