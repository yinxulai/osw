# 排版规范

> 本文是 [`design-system.md`](./design-system.md) 第二层（刻度与状态层）在**文字**上的细则，
> 覆盖 issue #124 的缺口：**排版规范**。
>
> 上游数值的出处与横向对照在 [`design-token-mapping.md`](./design-token-mapping.md) §2、§5；
> 本文只讲**怎么用**：字重、行高、字距、数字与等宽、截断与换行。
>
> **本文不改代码**：现状一律标注，缺口登记为待办。

## 0. 现状摘要

osw 有**两套并存的字阶**，这是本文最重要的一件事——它们**同名不同值**：

| 体系 | 定义在哪 | `2xs` | `xs` | `sm` | `md` | `xl` |
| --- | --- | --- | --- | --- | --- | --- |
| **`system-*` 实用类** | `styles/index.css:394-539`（`@utility`） | **11px** | **12px** | **13px** | **14px** | **16px** |
| **Tailwind `text-*`** | Tailwind 内置刻度 | 由 `--text-2xs` 定义 = **11px** | 12px | **14px** | — | — |

> ⚠️ **`sm` 在两套里不是一个字号**：`system-sm-*` = **13px**，`text-sm` = **14px**。
> `xs`（12px）与 `2xs`（11px）两边一致，只有 `sm` 撞车。
> 把 `text-sm` 换成 `system-sm-medium` 会**同时**改掉字号（14→13）和字重（继承→500）。
> 这是本仓库最容易写错的一处，改之前先确认要的是哪个 `sm`。

---

## 1. `system-*` 是主要字阶

排版的主体是 `styles/index.css:394-539` 的 `@utility` 块——**24 个**已定义，**16 个在用**。

### 1.1 完整阶梯（`[源码]`，逐条抄自 `styles/index.css`）

| 实用类 | 字号 | 字重 | 行高 | 大小写 | 使用次数 |
| --- | --- | --- | --- | --- | --- |
| `system-2xs-regular` | 11px | 400 | 16px | — | **119** |
| `system-2xs-medium` | 11px | 500 | 16px | — | **52** |
| `system-2xs-medium-uppercase` | 11px | 500 | 16px | UPPER | **10** |
| `system-2xs-semibold` | 11px | 600 | 16px | — | 1 |
| `system-2xs-semibold-uppercase` | 11px | 600 | 16px | UPPER | 1 |
| `system-2xs-regular-uppercase` | 11px | 400 | 16px | UPPER | **0（未用）** |
| `system-xs-regular` | 12px | 400 | 16px | — | **135** |
| `system-xs-medium` | 12px | 500 | 16px | — | **87** |
| `system-xs-semibold` | 12px | 600 | 16px | — | 4 |
| `system-xs-regular-uppercase` | 12px | 400 | 16px | UPPER | **0（未用）** |
| `system-xs-medium-uppercase` | 12px | 500 | 16px | UPPER | **0（未用）** |
| `system-xs-semibold-uppercase` | 12px | 600 | 16px | UPPER | **0（未用）** |
| `system-sm-regular` | 13px | 400 | 16px | — | 1 |
| `system-sm-medium` | 13px | 500 | 16px | — | **31** |
| `system-sm-semibold` | 13px | 600 | 16px | — | 4 |
| `system-sm-medium-uppercase` | 13px | 500 | 16px | UPPER | **0（未用）** |
| `system-sm-semibold-uppercase` | 13px | 600 | 16px | UPPER | 1 |
| `system-md-regular` | 14px | 400 | 20px | — | **0（未用）** |
| `system-md-medium` | 14px | 500 | 20px | — | 4 |
| `system-md-semibold` | 14px | 600 | 20px | — | 3 |
| `system-md-semibold-uppercase` | 14px | 600 | 20px | UPPER | **0（未用）** |
| `system-xl-medium` | 16px | 500 | 24px | — | 1 |
| `system-xl-semibold` | 16px | 600 | 24px | — | 8 |
| `system-kbd` | 12px | 500 | 16px | — | **0（未用）** |

**复现命令**：

```bash
cd packages/console/source
rg -o --no-filename '^@utility (system-[a-z0-9-]+)' -r '$1' styles/index.css   # 定义
rg -o --no-filename '\bsystem-[a-z0-9-]+\b' --glob '*.tsx' . | sort | uniq -c   # 使用
```

### 1.2 从这张表读出的三条规则

| # | 规则 | 依据 |
| --- | --- | --- |
| 1 | **字号只有 5 档：11 / 12 / 13 / 14 / 16px** | 表里只有这五个值。**没有 10、15、18px** |
| 2 | **行高只有 3 档：16 / 20 / 24px**，且 **≤13px 一律 16px** | 11、12、13px 三档共用 16px 行高——这是本系统的排版基线 |
| 3 | **"字号 + 字重 + 大小写"是一个整体**，不是三个独立旋钮 | 24 个实用类是这三者的组合。**不要**写成 `system-xs-regular font-medium`——那是在拆开一个已封装的组合 |

**关于第 3 条的例外**：`font-medium` 单独出现 **52 次**、`font-normal` **22 次**、`font-semibold` **5 次**。
它们多数落在**不用 `system-*` 的地方**（`text-sm` / `text-xs` 的调用点、`<body>` 默认）。
**规则**：用 `system-*` 时字重由它给；不用 `system-*` 时才单独写 `font-*`。

### 1.3 未使用的 8 个：要不要删

`system-2xs-regular-uppercase`、`system-xs-regular-uppercase`、`system-xs-medium-uppercase`、
`system-xs-semibold-uppercase`、`system-sm-medium-uppercase`、`system-md-regular`、
`system-md-semibold-uppercase`、`system-kbd`。

**本文不建议删**（删除是代码改动，不在范围内）。但登记一条**倾向**：

> 下一档字号（`md` = 14px）里只有 `medium` / `semibold` 在用，`regular` **从未被用过**——
> 说明 14px 的正文需求实际由 `text-sm` 承担。选字阶时优先用**已经被大量使用**的档
> （`system-xs-regular` 135 次、`system-2xs-regular` 119 次、`system-xs-medium` 87 次），
> 新增用法的优先级最低的是那 8 个 0 使用的组合。

---

## 2. 11px 是下限，但有两处越线

`styles/index.css:139-141` 的注释把规则写死了：

```
/* 排版基准：上游在 styles.css 里额外声明的小号字阶。
   本应用把 2xs 抬到 11px：10px 的中文在亮色下笔画会互相糊住，
   11px 是这套界面的**字号下限**，不要再往下压。 */
--text-2xs: 0.6875rem;
```

### 2.1 越线的四处 `text-[0.625rem]`（= 10px）

| 位置 | 用途 | 性质 |
| --- | --- | --- |
| `pages/overview/components/bill-content.tsx:38` | 账单品牌行 | **导出场景**——与 [`design-system-tokens.md`](./design-system-tokens.md) §3.3 的「导出场景层」同一类例外（账单是印在票据上的，不是界面） |
| `bill-content.tsx:52` | 账单表头 | 同上 |
| `bill-content.tsx:107` | 账单页脚网址 | 同上 |
| **`components/ui/questionnaire.tsx:138`** | **快捷键徽标（`A`/`B`/`C`）** | ⚠️ **这是真正的越线**——它是界面里的元素，不是导出物 |

**结论**：10px 只有 **1 处**真正活在界面上（问卷快捷键徽标）。修法不是"把下限降到 10px"，
而是把那处改成 **`text-2xs`（11px）** 或 `system-kbd`（12px，它 0 使用，本就是为键盘提示准备的）。

### 2.2 其余任意字号

| 任意值 | 处数 | 折算 | 位置 | 处置 |
| --- | --- | --- | --- | --- |
| `text-[13px]` | **25** | 13px | 主要在 `components/ui/`（`dropdown-menu` `select` `input-group` 等） | → **`system-sm-*`**（同为 13px/16px）。**但 25 处里 19 处同行带 `leading-4`**，说明作者是"13px + 16px 行高"手写出来的 `system-sm-*` |
| `text-[12px]` | 4 | 12px | — | → `system-xs-*` / `text-xs`（都是 12px） |
| `text-[14px]` | 1 | 14px | — | → `text-sm` 或 `system-md-*` |
| `text-[0.8rem]` | 3 | 12.8px | `toggle.tsx:18` `calendar.tsx:93,102` | ⚠️ **不在任何刻度上**（12.8px）。→ `system-xs-*`（12px）或 `system-sm-*`（13px） |
| `text-[0.7rem]` | 1 | 11.2px | `bill-content.tsx:41` | 导出场景例外 |
| `text-[0.5rem]` | 1 | 8px | `bill-content.tsx:98` | 导出场景例外 |
| `text-[2.3rem]` | 1 | 36.8px | `bill-content.tsx:93` | 导出场景例外 |
| `text-[0.625rem]` | 4 | 10px | 见 §2.1 | 3 处导出例外 + **1 处越线** |

**合计**：字号任意值 **40 处**（px 底 30 + rem 底 10），其中 **25 处（62%）是 13px**
——正好对应 [`design-token-mapping.md`](./design-token-mapping.md) §7.4 登记的候选 token
`--text-compact`（13px/16px）。**13px 这一格三家成熟系统都没有**（Carbon 12→14 直跳），
是 osw 自己的品牌层取值，所以它值得一个 token 而不是 25 处任意值。

> **口径说明**（不制造矛盾）：本文只统计**字号**。全属性任意像素的总数见
> [`design-token-mapping.md`](./design-token-mapping.md) §1.1（78 处）。
> 两者的 glob 与是否含 `0.5px` 描边类不同 → 见 §9 未核实项。

---

## 3. 字重只有四档（在用）

| 字重 | 类名 | 次数 | 用途 |
| --- | --- | --- | --- |
| 400 | `font-normal` | 22 | 正文 |
| 500 | `font-medium` | **52** | 主用：标签、按钮、表头、小标题 |
| 600 | `font-semibold` | 5（另加 8 处 `system-xl-semibold`） | 数值、卡片标题 |
| **900** | `font-black` | **2** | ⚠️ 全部在 `bill-content.tsx:93` 的账单大数字（**导出场景**） |

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **界面里只用 400 / 500 / 600**。900 只出现在导出物上 |
| 2 | **500 是主力**，不是 600。中文在 600 下笔画会明显加粗，层级靠**字号 + 颜色**（`text-text-primary` → `text-text-tertiary`）拉开，不是靠字重 |
| 3 | **不要出现 3 个以上字重同屏**。同一个组件里最多两个 |
| 4 | 字重必须能过对比度——600 的白字在小字号下仍按 [`design-system-accessibility.md`](./design-system-accessibility.md) §1 的 4.5:1 要求，**字重不产生豁免** |

---

## 4. 行高：16px 是基线

### 4.1 事实

`system-*` 的行高只有 **16 / 20 / 24px** 三档（§1.1），且 **≤13px 一律 16px**。
手写 `leading-*` 的使用：

| 类名 | 次数 | 数值 | 说明 |
| --- | --- | --- | --- |
| `leading-4` | **26** | 16px | 与 `system-*` 的基线一致 ✅ |
| `leading-none` | 13 | 1 | 单行徽标、大数字、图标行 |
| `leading-5` | 8 | 20px | 与 `system-md-*` 一致 ✅ |
| `leading-snug` | 5 | 1.375 | ⚠️ 相对值，随字号变 |
| `leading-normal` | 2 | 1.5 | ⚠️ 同上 |
| `leading-tight` | 1 | 1.25 | ⚠️ 同上 |
| `leading-relaxed` | 1 | 1.625 | ⚠️ 同上 |

### 4.2 规则

| # | 规则 |
| --- | --- |
| 1 | **优先用 `system-*`，不要手写行高**——它已经把字号/字重/行高打包好了 |
| 2 | 必须手写时，**用固定像素**（`leading-4` 16px / `leading-5` 20px），**不用相对值**（`leading-snug` 等）。相对值会随字号漂移，同一行文案换字号后行高就不是刻度上的数了 |
| 3 | `leading-none` 只用于**单行**（徽标、大数字、图标排）。**多行文字用 `leading-none` 会粘在一起** |
| 4 | **行高决定行盒高度**，表格行的 `py-*` 是加在行高之上的——这是 [`design-system-data-display.md`](./design-system-data-display.md) §2 密度计算的前提 |

---

## 5. 字距

### 5.1 事实

`html`/`body` 上写了 `letter-spacing: 0`（`styles/index.css:671`）——**基准是"不加字距"**。
在此之上手写的 `tracking-*`：

| 类名 | 次数 | 数值 | 用途 |
| --- | --- | --- | --- |
| `tracking-widest` | 5 | 0.1em | 账单小字（导出场景） |
| `tracking-wide` | 3 | 0.025em | 同上 |
| `tracking-tight` | 2 | -0.025em | — |
| `tracking-[1.2px]` | 2 | 1.2px | — |
| `tracking-wider` | 1 | 0.05em | — |
| `tracking-[0.2em]` / `[0.22em]` / `[0.18em]` / `[0.16em]` / `[0.08em]` | 各 1 | — | **全部在 `receipt-printer-preview/machine.tsx`**（打印机模拟器）+ `bill-content.tsx` |

### 5.2 规则

| # | 规则 |
| --- | --- |
| 1 | **中文不加字距**。中文每个字都是满宽方块，加字距会把词打散。`tracking-*` 只用于**全大写的拉丁字母** |
| 2 | **大写 + 字距是一对**：`system-*-uppercase` 的 12 处使用几乎都配 `tracking-*`。两者要么一起用，要么都不用 |
| 3 | **界面里不用 em 字距**：`tracking-[0.2em]` 这类全在**导出/模拟场景**（票据、打印机预览）。界面文案的字距问题应该由字号与字重解决 |
| 4 | **字距基准是 0**，任何 `tracking-*` 都是有意为之，需要注释说明为什么 |

---

## 6. 数字与等宽

### 6.1 事实

| 项 | 次数 | 用途 |
| --- | --- | --- |
| `tabular-nums` | **49** | 数值对齐（统计卡、表格数字列、耗时、token 数） |
| `font-mono` | **149** | 代码、ID、URL、端口、模型名 |
| `font-sans` | 1 | 显式复位（几乎不需要） |

字体族（`styles/index.css:64-68`）：

```css
--font-sans: 'Geist Variable', sans-serif;
--font-mono: "Source Code Pro", "SF Mono", "Fira Code", ui-monospace, SFMono-Regular,
             Menlo, Monaco, Consolas, monospace;
```

### 6.2 规则（这条是硬规则，不是偏好）

| # | 规则 | 理由 |
| --- | --- | --- |
| 1 | **会随数据变化的数字必须 `tabular-nums`**：统计值、耗时、用量、价格、token 数、倒计时 | 比例数字会让数值跳动（`111` 比 `999` 窄），一屏多个数字就永远对不齐 |
| 2 | **一列数字里有一处 `tabular-nums`，整列都要有** | 对齐是列的性质，不是单元格的 |
| 3 | **机器标识一律 `font-mono`**：ID、端口、URL、模型名、字段路径、密钥前缀 | 这些要能逐字符核对 |
| 4 | **中文正文不要用 `font-mono`** | `Source Code Pro` 没有中文字形，会回落到系统字体，出现中英混排的字面差异 |
| 5 | **`tabular-nums` 与 `font-mono` 是两件事**，可以叠加：等宽字体里的数字仍建议显式加 `tabular-nums`（`Source Code Pro` 本身是等宽的，但换字体后就不保证了） |
| 6 | **数字不要写进目录**（[`i18n.md`](../data/i18n.md) §4）：用 `Intl.NumberFormat` / `Intl.DateTimeFormat` 按当前 locale 格式化 | 中文的千分位与日期格式和英文不同 |

---

## 7. 截断与换行

### 7.1 事实

| 类名 | 次数 | 语义 |
| --- | --- | --- |
| `min-w-0` | **182** | flex 子项允许收缩——**截断的前提** |
| `truncate` | **101** | 单行截断 + 省略号 |
| `whitespace-nowrap` | 19 | 不换行（未必截断） |
| `break-all` | 8 | 任意位置断行（URL、哈希、无空格长串） |
| `line-clamp-2` | 5 | 两行截断 |
| `line-clamp-1` | 2 | 一行截断（等价 `truncate`，但可用于多行盒） |
| `break-words` | 4 | 按词断行 |
| `text-balance` | 5 | 标题平衡断行 |
| `text-pretty` | 4 | 段落避免孤字 |
| `line-clamp-3` | **0** | — |

### 7.2 规则

| # | 规则 | 说明 |
| --- | --- | --- |
| 1 | **`truncate` 必须配 `min-w-0`** | flex 子项默认 `min-width: auto`，不给 `min-w-0` 就**不会**截断，只会把容器撑宽——这是最常见的"截断没生效"原因。182 处 `min-w-0` 说明这条已经被广泛遵守 |
| 2 | **截断了就必须能看全** | 单行截断的元素要有 `title` 或包一个 `Tooltip`。**文案是自己写的**（模型名、URL）→ 必须；**文案是用户数据**（规则描述）→ 用 `line-clamp-2` 给两行更划算 |
| 3 | **机器标识用 `break-all`，自然语言用 `break-words`** | 模型名/URL 里没有空格，`break-words` 对它无效；中文没有词边界，`break-all` 对中文无影响但会切断英文单词 |
| 4 | **表格单元格的默认策略是 `truncate` + `min-w-0`**，需要换行的列（描述、错误信息）显式用 `line-clamp-2` | 表格行高由 [`design-system-data-display.md`](./design-system-data-display.md) §2 规定，允许换行会让行高不齐 |
| 5 | **不要用 `whitespace-nowrap` 当"防换行"的手段** | 它会让内容溢出容器。需要不换行且不溢出 → `truncate` |
| 6 | **标题用 `text-balance`，正文用 `text-pretty`** | 两者都在用（5 / 4 处），这是对的 |
| 7 | **中英混排的截断点不可控** | `truncate` 在中文里是按字符切的，可能在词中间断开。**接受这个结果**——不要为了"在词边界断"自己算长度 |

### 7.3 待补缺口

| 缺口 | 说明 |
| --- | --- |
| **`line-clamp-3` 0 使用** | 说明要么是 1/2 行，要么是不截断。**当前不是问题**（表格行高需要稳定），但如果将来要放"两行以上"的描述，先确认行高会不会破 |
| **`title` 属性的覆盖率未核** | 101 处 `truncate` 里有多少带了完整文案的出口，**没有统计**（需要逐个判断是否是用户数据）→ 见 §9 |

---

## 8. 落地清单

改动文字样式时逐条过：

- [ ] 用的是 `system-*` 而不是手拼"字号 + 字重 + 行高"
- [ ] 没有把 `text-sm`（14px）当成 `system-sm-*`（13px）
- [ ] 字号落在 **11 / 12 / 13 / 14 / 16px** 五档之内，没有 12.8px 这类中间值
- [ ] 没有低于 **11px**（唯一例外是导出场景，须注释）
- [ ] 行高是 **16 / 20 / 24px** 之一，没用 `leading-snug` 这类相对值
- [ ] 同屏字重不超过两个，且没有 900
- [ ] 变化的数字有 `tabular-nums`，且整列都有
- [ ] 机器标识有 `font-mono`
- [ ] 中文没有加 `tracking-*`
- [ ] `truncate` 配了 `min-w-0`，且截断后有看全文的出口
- [ ] 数字与日期没有被写进 i18n 目录

---

## 9. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **任意像素总数的口径差异（78 vs 104）** | `[未核实]` | 本文与 [`design-token-mapping.md`](./design-token-mapping.md) §1.1 的计数命令与 glob **没有记录在同一处**，本次以 `--glob '*.tsx'` 全量复测得 **104** 处（含 `border-[0.5px]` 等描边类），排除 `0.5px`/`1.5px` 后得 **81**，仍与 78 差 3。**差异原因未核实**。本文的结论只依赖**字号**这一子集（40 处，其中 `text-[13px]` 25 处与映射文档 §2.3 逐字一致），不受该差异影响 |
| **`--text-2xs` 没有配行高** | `[未核实]` | `styles/index.css:141` 只声明了 `--text-2xs: 0.6875rem`，**没有** `--text-2xs--line-height`。所以 `text-2xs` 只设字号不设行高（4 处使用各自带 `leading-4`）。这是有意（让调用方自选行高）还是遗漏，无法从代码判定 |
| **`text-[13px]` 的 25 处是否都该换成 `system-sm-*`** | `[未核实]` | 19 处同行带 `leading-4`（与 `system-sm-*` 的 16px 行高一致），但**另外 6 处没有**——那 6 处的行高来自父级或 Tailwind 默认（`text-[13px]` 不带行高，会继承）。**逐处核对才能判定**，本文只登记方向 |
| **`leading-snug`/`leading-normal` 等相对值在中文下的实际行距** | `[未核实]` | 相对行高乘以字号后得到非整数像素，中文基线位置与拉丁文不同。**需要真机看**，本文只按"不落在刻度上"登记 |
| **`title` 属性和 Tooltip 对截断内容的覆盖完整性** | `[未核实]` | 需要逐个判断 101 处 `truncate` 的内容是不是用户数据。**未统计** |
| **`system-kbd` 的定位** | `[未核实]` | 它定义于 `styles/index.css:535-539`，**0 处使用**；而 `components/ui/kbd.tsx` 是另一套实现。两者关系（是否重复）未核实 |
