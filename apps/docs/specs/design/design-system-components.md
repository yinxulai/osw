# 组件 API 约定

> 本文是 [`design-system.md`](./design-system.md) 第一层（行为层）与第三层（品牌层）的**执行细则**，
> 覆盖 issue #124 的缺口：**组件 API 约定**。
>
> [`design-system.md`](./design-system.md) 原文只有一句话（"交互行为一律来自 Radix 原语"），
> 本文把它展开成 **可判定的四条规则**：什么做成 variant、什么让调用方组合、
> props 怎么命名、新增一个组件的门槛。
>
> **本文不新增组件、不改组件 API**——只记录现状与约定。

## 范围

工作对象是 `packages/console/source/components/ui/*`（40 个 `.tsx`，含 2 个测试文件）
与 `packages/console/source/components/*`（应用级组合组件）。

---

## 1. 现状基线（实测）

写约定之前先把现状钉死，后面的规则都是对**已存在的做法**的确认或收紧。

| 项 | 实测结果 | 命令 |
| --- | --- | --- |
| `cva` 使用 | **7 个文件**调用 `cva()` | `rg -l 'cva\(' components/ui` |
| `data-slot` | **26 个文件、184 处** | `rg -c 'data-slot' components/ui` |
| `cn()` 工具 | `lib/utils.ts:4` → `twMerge(clsx(inputs))` | — |
| barrel 文件 | **不存在**（`components/ui/` 无 `index.ts`） | — |
| `forwardRef` | **仅 3 处**：`button.tsx:61`、`dialog.tsx:39`、`alert-dialog.tsx` | `rg -l forwardRef components/ui` |
| props 类型 | `React.ComponentProps<"button">`（原生）／`React.ComponentProps<typeof XPrimitive.Root>`（Radix）／`VariantProps<typeof xVariants>` | — |
| `asChild` | **3 个组件**显式声明（`button` `badge` `button-group`） | — |
| `components-*` token 使用 | `components/ui/` 里 8 个文件；全部 `packages/console/source` 里 41 个文件 | — |

**两个必须知道的坑**：

1. **`components/ui/` 已经做过一次减法**：只保留有真实调用方的原语，
   从未被 import 的官方脚手架（`field` / `sidebar` / `carousel` / `menubar` / `navigation-menu`
   等 28 个）已删除。**新增原语前先确认至少有一个调用点**，否则不要落盘。
   表单体系始终是 `components/form-kit.tsx`（228 行，**28 个文件**引用）。
2. **`components/ui/table.tsx` 只有 2 个文件用**（`logs-table.tsx`、`rules-table.tsx`）。
   应用级表格走 `components/table-primitives.tsx` 的类常量，第三张表甚至直接写裸 `<table>`。
   见 [`design-system-data-display.md`](./design-system-data-display.md) §4。

---

## 2. variant 还是组合：判定规则

这是缺口里的第一个问题。**判定顺序是从上往下，第一个命中的就是答案**。

```
这个差异能不能只靠换 token 通道（bg / text / border）表达？
├─ 不能（DOM 结构不同）──────────────────────→ 组合
└─ 能
   ├─ 差异是封闭集合（能穷举，且不会每周加一个）？
   │  ├─ 不是（调用方各写各的）───────────────→ 组合
   │  └─ 是
   │     ├─ 有 ≥2 个调用点需要它？─────────────→ variant
   │     └─ 只有 1 个调用点 ─────────────────→ 就地写类名（连组合都不必）
```

### 2.1 判据表

| # | 判据 | 满足时 | 反例 |
| --- | --- | --- | --- |
| 1 | **结构相同**：只差 token 通道，DOM 树一模一样 | 可以做成 variant | 需要多一个 `<footer>` 槽 → 组合 |
| 2 | **集合封闭**：变体名能穷举，且不随业务增长 | 可以做成 variant | "每个供应商一个变体" → 组合或数据驱动 |
| 3 | **跨页面复用**：≥2 个调用点 | 值得做成 variant | 单点 → 就地写 |
| 4 | **不需要新子元素**：调用方不需要传结构 | 可以做成 variant | 需要传 icon/footer/action → 用 `children` + 数据属性，或用组合 |

### 2.2 仓库里的正例

**variant ✅ —— `Button` 的 6 档**（`components/ui/button.tsx:14-23`）：
`default` / `outline` / `secondary` / `ghost` / `destructive` / `link`。
六档结构完全相同，只换 token 通道；集合封闭；全应用复用。**完全符合四条判据。**

**组合 ✅ —— `ConfirmDialog`**（`components/ui/confirm-dialog.tsx`）：
它不是 `AlertDialog` 的一个 variant，因为它**需要额外内容**（title、description、两个按钮文案）。
它暴露的是**内容槽 + 语义事件**，不是新样式：

```tsx
interface ConfirmDialogProps {
  open: boolean                                    // 受控，必填
  title: ReactNode                                 // 内容槽
  description: ReactNode                           // 内容槽
  confirmLabel?: string                            // 可选，缺省走 i18n
  cancelLabel?: string
  variant?: ComponentProps<typeof Button>['variant']  // 【关键】转发布尔/枚举，不重定义
  onConfirm: () => void                            // 语义事件
  onOpenChange: (open: boolean) => void
}
```

**`variant?: ComponentProps<typeof Button>['variant']` 是本文要固化的写法**：
组合组件需要"把底层的某个旋钮透出去"时，**从底层组件的 props 类型里取**，
不要自己重新声明一遍 `'default' | 'outline' | …`——否则 Button 加一档，这里就悄悄少一档。

**组合 ✅ —— `TableStateRow`**（`components/table-state.tsx:5-13`）：
空态/错误态占位行，暴露 `colSpan` / `icon` / `title` / `description` / `tone` / `action`。

### 2.3 反例：不该做成 variant 的三种写法

| 反例 | 为什么错 | 正确做法 |
| --- | --- | --- |
| `variant="with-left-icon"` | 图标是**内容**不是样式，且图标集合是开放的 | Button 已经用 `data-icon="inline-start"` + 子元素解决（`button.tsx:30` 的 `has-data-[icon=inline-start]:pl-2.5`） |
| `variant="danger"` 与 `variant="delete"` 并存 | 同一视觉、两个名字，调用方要猜 | 一个视觉一个名字：`destructive` |
| `variant` 里塞布局（`variant="full-width"`） | 布局不是外观变体，且它会被 `className` 覆盖 | 调用方传 `className="w-full"` |

---

## 3. props 命名约定

| # | 规则 | 依据 / 示例 |
| --- | --- | --- |
| 1 | **原生语义优先**：能继承就继承，不重命名 | `React.ComponentProps<"button">` → `disabled` / `hidden` 直接可用，不要造 `isDisabled` |
| 2 | **布尔用裸形容词** | `asChild`（`button.tsx:53`）、`loading`（`sonner.tsx:25`）、`embedded`（`empty-state.tsx`） |
| 3 | **组件内部状态才用 `is*`** | `isMobile`（`hooks/use-mobile.ts:6`）。**不要再新增**：原 `pagination.tsx` / `sidebar.tsx` 里的 `isActive` 已随文件删除 |
| 4 | **不用 `has*` 前缀** | 全仓 **0 处**。存在性判断走 `has-data-*` 这类 CSS 变体，不做成 prop |
| 5 | **枚举用单个 prop，不用多个布尔** | `tone?: 'muted' \| 'destructive'`（`table-state.tsx:10`），而不是 `isMuted` + `isDestructive`。多个布尔会产生"两个都为 true"的非法组合 |
| 6 | **受控 props 沿用 Radix 名** | `open` + `onOpenChange`（`confirm-dialog.tsx:17-18`）。**不要**改成 `visible` / `onVisibleChange` |
| 7 | **事件用动词，不加 `Click`** | `onConfirm`、`onRetry`。不是 `onConfirmClick` |
| 8 | **内容槽用名词 + `ReactNode`** | `title` / `description` / `action` / `confirmLabel` |
| 9 | **文案不硬编码** | 可选 + i18n 缺省：`confirmLabel ?? t('common.confirm.confirmLabel')`（`confirm-dialog.tsx:39`）。硬编码 CJK 会被 `no-hardcoded-cjk` ESLint 规则拦下，见 [`design-system-copy.md`](./design-system-copy.md) |
| 10 | **`className` 永远最后合并** | `cn(xVariants({ variant, size, className }))`——保证调用方能覆盖 |
| 11 | **`size` 不写参数默认值** | `button.tsx:65` 注释原文：写了会盖掉 cva 的 `defaultVariants`。默认值只放 `defaultVariants` |

### 3.1 每个组件必须带的四件套

新增或修改 `components/ui/*` 组件时，这四项缺一即为不符合约定：

| 项 | 形式 | 为什么 |
| --- | --- | --- |
| **`data-slot`** | `data-slot="kebab-name"`，放在该子组件渲染出的**根元素**上 | 26 个文件、184 处在用；`styles/index.css:27-41` 的窗口拖拽豁免、以及大量 `[data-slot=…]` 选择器都依赖它 |
| **`className` 透传** | `React.ComponentProps<"…">` 已含，但必须真的用 `cn()` 合并 | 调用方唯一的逃生口 |
| **状态数据属性** | `data-variant` / `data-size` / `data-state` | `button.tsx:69-70` 就导出了 `data-variant` + `data-size`；让样式与测试都能不靠类名定位 |
| **`asChild`（可选）** | `asChild?: boolean` + `const Comp = asChild ? Slot.Root : "button"` | 需要嵌入 `<a>` / 路由 `<Link>` 时必需 |

**`Slot` 的来源**：`import { Slot } from "radix-ui"`（`button.tsx:3`）。
仓库只用 `radix-ui` 统一包，**不再有 `@radix-ui/react-*` 分包依赖**（已随死原语一并移除），
新代码也只准用统一包。

### 3.2 `forwardRef` 只在一个理由下使用

`button.tsx:56-60` 的注释把理由写死了：

> 必须 `forwardRef`：Radix 的 `asChild` 触发器（`DropdownMenuTrigger` 等）要把 ref
> 落到真实 DOM 上才拿得到浮层锚点。普通函数组件在 React 18 下接不住 ref，
> 锚点为空时浮层会被摆到视口外（`translate(0, -200%)`），看起来就是"点了没反应"。

**规则**：只有"这个组件会被当作 `asChild` 的目标"时才 `forwardRef`。
其余组件用普通函数组件（全仓只有 3 处 `forwardRef`，这是对的，不要扩散）。

---

## 4. 尺寸与变体的取值必须落在刻度上

| 组件 | 尺寸档 | 高度 | 与刻度的关系 |
| --- | --- | --- | --- |
| `Button` | `xs` / `sm` / `default` / `lg` | 24 / 28 / 32 / 36px | 见下方说明 |
| `Button` | `icon-xs` / `icon-sm` / `icon` / `icon-lg` | 24 / 28 / 32 / 36px | 与上表同高，仅宽度=高度 |
| `Input` | （无档，固定） | **32px**（`h-8`） | 与 `Button` 的 `default` 对齐 |
| `Select` / `NativeSelect` | `sm` / `default` | — | — |
| `Avatar` | `sm` / `default` / `lg` | — | — |
| `Card` / `AlertDialog` | `sm` / `default` | — | — |
| `Switch` | `sm` / `default` | — | — |

**`lg` = 36px 是半档**——Carbon 的尺寸刻度是 32 → 40，没有 36。
[`design-token-mapping.md`](./design-token-mapping.md) §4.2/§4.3 已把 `h-9`(36px) 判为需要归并的档，
并给出桌面产品收敛成 **28 / 32 / 40 三档 + 44px 触控下限**的建议。**该结论在本文不重复论证**，
只登记一条组件侧的约束：

> 新增尺寸档时，取值必须来自 [`design-token-mapping.md`](./design-token-mapping.md) §4.3 的三档
> （28 / 32 / 40）之一，不要新增 36px 这类"两档之间"的高度。

**默认尺寸必须与 `Input` 对齐**：`button.tsx:41-43` 注释原文——"默认尺寸与 Input / Select
保持一致（h-8、text-sm）：表单行里按钮和输入框不等高是最容易看出来的不齐，所以默认值不再取 sm。"

---

## 5. `components-*` token 与组件的关系

`components-*` token 是**组件自己的状态档位**，它与组件是一对一的契约关系。
完整清单见 [`design-system-tokens.md`](./design-system-tokens.md) §2.2；这里只讲**关系规则**。

### 5.1 三条边界规则

| # | 规则 | 说明 |
| --- | --- | --- |
| 1 | **一个前缀只服务一个组件** | `components-button-*` 只允许 `components/ui/button.tsx` 使用。别的组件想要按钮外观，就**渲染一个 `<Button>`**，不要借用 token |
| 2 | **通道后缀固定五个** | `-bg` / `-bg-hover` / `-text` / `-border` / `-border-hover`。新增通道必须沿用其中之一 |
| 3 | **变体名进 token 名** | `components-button-{primary,secondary,tertiary,ghost,destructive-ghost}-*`。变体是 token 名的一部分，所以**改 variant 名就是改 token 名**，两处必须同步 |

### 5.2 组件名 ↔ token 前缀 ↔ variant 名（现况对照）

**注意这张表里有一层名字错位**，读代码时最容易搞混：

| variant 名（写在 TSX 里） | 它用的 token 前缀（`components-button-` 之后） | 对应成熟系统的叫法 |
| --- | --- | --- |
| `default` | `primary-*` | Primer `primary` |
| `outline` | `secondary-*` | Primer `default` / `outline` |
| `secondary` | `tertiary-*` | Primer 的次级填充 |
| `ghost` | `ghost-*` | Primer `invisible` |
| `destructive` | `destructive-ghost-*`（**例外**：bg 走 `bg-destructive/10`，不是 components token） | Primer `danger` |
| `link` | `text-primary` + `underline`（**无 components token**） | Primer 的 link 按钮 |

**这张表的三个已知缺口**（[`design-token-mapping.md`](./design-token-mapping.md) §6.3 已详列）：

1. **`destructive` 变体没有 components token**——它的底色是 `bg-destructive/10`，用 alpha 叠语义色。
   这意味着它**只有一个通道走 token**，其余走 alpha，明暗两套无法各自校正。
2. **`link` 变体完全没有 components token**——直接写 `text-primary`。它也**不在**
   [`design-token-mapping.md`](./design-token-mapping.md) §6.2 的状态矩阵里（那张表只列了 5 个变体）。
3. **focus 环不随变体语义走**——五个变体统一 `focus-visible:ring-state-accent-solid`，
   只有 `destructive` 例外写 `focus-visible:ring-destructive/20`。

### 5.3 状态矩阵缺口的组件侧对应

[`design-token-mapping.md`](./design-token-mapping.md) §6.3 列了约 23 个缺失格子，
组件侧要补的是这些（**不在此执行，仅登记**）：

| 缺的格子 | 组件侧现状 | 要改的位置 |
| --- | --- | --- |
| `-bg-active`（按下态，5 变体） | 用 `active:not-aria-[haspopup]:translate-y-px` 的**几何位移**代替 | `button.tsx:8` 根类 |
| `-{bg,text,border}-disabled` | 用 `disabled:opacity-50` 全局压暗 | `button.tsx:8` 根类 |
| `focus-ring`（按变体） | 统一 `ring-state-accent-solid`；**宽度还与 4 处 `ring-[3px]` 冲突** | `button.tsx:8,20` |
| `loading` | **无 loading 契约**（`Spinner` 组件存在但 Button 不接） | `button.tsx` props |
| `selected` / `aria-pressed` | 无选中态 token | `button.tsx` variants |
| `icon-color`（独立于 text） | 图标继承 `text` | `button.tsx` |

**补格子时必须同时满足**：① 走 [`design-system-tokens.md`](./design-system-tokens.md) §6 的
新增 token 门槛；② 在 `.dark` 给出覆盖；③ 更新
[`design-system-tokens.md`](./design-system-tokens.md) §2.2 的清单。

---

## 6. 新增一个组件的门槛

**七条全过才允许新增 `components/ui/*` 文件**。任一条不过，说明应该改现有组件或就地组合。

| # | 条件 | 怎么验 |
| --- | --- | --- |
| 1 | **现有组件组合不出来** | 先用现有组件写一遍。组合得出来 → 不需要新组件 |
| 2 | **行为层有 Radix 原语对应** | 凡是需要"记住用户在什么状态下按了什么"的（焦点陷阱、`Esc` 逐层、键盘导航、滚动锁），**必须有原语**。**找不到原语说明需求本身有问题**——先把需求改到能用真元素或原语表达，**不许手写**（[`design-system.md`](./design-system.md) §第一层的 7 条红线） |
| 3 | **≥2 个调用点** | 单点使用就地写，不建组件 |
| 4 | **视觉取值全部来自现有 token** | 需要新 token → 先过 [`design-system-tokens.md`](./design-system-tokens.md) §6 的门槛 |
| 5 | **带齐四件套** | §3.1：`data-slot` + `className` 透传 + 状态数据属性 + （如需）`asChild` |
| 6 | **有测试** | 仓库已有 `button.test.tsx`、`sheet.test.tsx` 的先例 |
| 7 | **登记** | 加进本文 §1 的基线表（如果改变了计数）；新增 token 则同步 tokens 文档 §2 |

### 6.1 不允许新增的类型

| 类型 | 为什么 |
| --- | --- |
| **同一组件的"更简单版本"** | 用现有组件的 props 收窄（如 `empty-state.tsx` 是 `Empty` 的兼容包装）。两个文件会让"该用哪个"永远没有答案 |
| **另一个图标库的包装** | 图标库只有 `lucide-react` 一个，见 [`design-system-icons.md`](./design-system-icons.md) §1 |
| **只改 `className` 的包装** | 直接传 `className` 即可 |
| **无 Radix 原语的手写浮层** | 违反第一层红线 |

### 6.2 新增后必须同步的位置

| 位置 | 同步什么 |
| --- | --- |
| 本文 §1 基线表 | `cva` / `data-slot` / `asChild` 计数（若改变） |
| [`design-system-tokens.md`](./design-system-tokens.md) §2.2 | 新的 `components-*` token |
| [`design-system-accessibility.md`](./design-system-accessibility.md) §1-§4 | 新组件的对比度 / 目标尺寸 / 焦点 / 键盘是否达标 |
| [`design-system-icons.md`](./design-system-icons.md) §4 | 新组件的图标尺寸档 |
| [`design-system-data-display.md`](./design-system-data-display.md) §4-§6 | 若是表单/表格类组件 |

---

## 7. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **variant 名与 token 前缀的错位是有意还是历史偶然** | `[未核实]` | `default`↔`primary-*`、`outline`↔`secondary-*` 这层错位在仓库里**没有任何注释解释**。可能是沿用 shadcn 的 variant 名 + 上游的 token 名，但无法从代码判定是否有意 |
| **`Empty`（`empty.tsx`）与 `EmptyState`（`empty-state.tsx`）的取舍** | `[未核实]` | `empty-state.tsx` 自称 "Compatibility wrapper built from the official shadcn Empty primitives"，但两者都在用（12 个文件用 `EmptyState`，`inline-empty-state.tsx` 是第三套）。是"迁移中"还是"两套都要"无法判定。见 [`design-system-data-display.md`](./design-system-data-display.md) §6 |
| **`Radix` 原语的完整覆盖清单** | `[未核实]` | 本文只确认了"手写键盘逻辑的文件清单"（见 [`design-system-accessibility.md`](./design-system-accessibility.md) §4.3），**没有**逐个核对每个浮层的 `Esc` / 焦点陷阱是否真的来自原语而非 shadcn 层的二次封装。这是 [`design-system-accessibility.md`](./design-system-accessibility.md) §10 未核实项里登记的同一条 |
