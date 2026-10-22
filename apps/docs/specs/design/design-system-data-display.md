# 表单与数据表格

> 本文是 [`design-system.md`](./design-system.md) 第二层（刻度与状态层）在**数据密集界面**上的细则，
> 覆盖 issue #124 的缺口：**表单与数据表格**。
>
> 这一层是 [`design-token-mapping.md`](./design-token-mapping.md) §1.3、§4 里"借 Carbon"的那部分——
> 数据密集表格、批量操作、密度刻度。**上游数值的出处在那份文档**，本文只讲怎么用。
>
> **本文不改代码**：现状一律标注，缺口登记为待办。

## 0. 五个表格，三种实现

`[源码]` 实测：仓库里有 **5 张表**，但它们**不复用同一个东西**：

| # | 表格 | 列数 | 表头 | 行 | 用的常量 |
| --- | --- | --- | --- | --- | --- |
| 1 | `pages/logs/components/logs-table.tsx` | 3 | `ui/table.tsx` + `tableHeaderClass` | `tableRowClass` | 全部常量 ✅ |
| 2 | `pages/request-logs/components/request-logs-table.tsx` | 11 | 裸 `<thead>` + `tableHeaderClass` | `tableCellClass` | 常量 ✅ |
| 3 | `pages/request-rewrite-rules/components/rules-table.tsx` | 7 | 裸 `<th className="px-4 py-2">` | `tableRowClass` | **表头/表体手写类名** ⚠️ |
| 4 | `pages/overview/components/model-ranking.tsx` | 8 | 裸 `<table>` + `tableHeaderClass` | 常量 | 混合 |
| 5 | `pages/overview/components/provider-detail.tsx:59` | — | 裸 `<table className="w-full min-w-180 system-xs-regular">` | 手写 | **全靠手写** ⚠️ |

**共享的部分**是 `components/table-primitives.tsx` 的四个类常量 + `TableFrame` / `TableViewport`
/ `TablePager` / `SortableHeader` 四个组件。**`components/ui/table.tsx` 只有 2 个文件引用**
（表 1、表 2），所以它**不是**表格的公共基础——公共基础是 `table-primitives.tsx`。

> **规则**：新增表格用 `table-primitives.tsx` 的常量与组件，**不要**照抄 `components/ui/table.tsx`，
> 也不要手写 `px-3 py-2.5`。缺口是**表 3 / 表 5 没有复用**：`rules-table.tsx` 写成 `px-4 py-2`，
> 与常量的 `px-3 py-2` 不一致，两张表的表头缩进不同。

---

## 1. 类常量：表格的密度定义在这里

`[源码]`，`components/table-primitives.tsx:8-11`：

| 常量 | 值 | 折算 |
| --- | --- | --- |
| `tableHeaderClass` | `border-b border-border/50 bg-inset text-left system-2xs-medium text-text-tertiary` | 表头**字号 11px / 字重 500 / 行高 16px**，底色比卡片深一档（`bg-inset`） |
| `tableHeaderCellClass` | `px-3 py-2 font-medium` | 表头单元格：左右 **12px**、上下 **8px** |
| `tableCellClass` | `px-3 py-2.5` | 表体单元格：左右 **12px**、上下 **10px** |
| `tableRowClass` | `border-b border-border/40 transition-colors last:border-0 hover:bg-state-base-hover` | 行分隔线 40% 的 `border`，最后一行的线去掉，悬停整行变色 |

### 1.1 推算出的行高（**推算，非实测**）

| 位置 | 计算 | 高度 |
| --- | --- | --- |
| 表头 | `py-2`×2 (16) + 行高 16 = | **32px**（表 1、表 2 还显式写了 `h-8`=32px 印证 ✅） |
| 表体（纯文字） | `py-2.5`×2 (20) + 行高 16 = | **36px** |
| 表体（含 20px 徽标） | `py-2.5`×2 (20) + `h-5` (20) = | **40px** |

> **行高由该行最高的单元格决定。** 表 1 的 `level` 列放了 `h-5` 的徽标，
> 所以**整表行高是 40px 而不是 36px**。这不是缺陷，但改任何一列的单元格高度都会改整表行高——
> 这是最容易被忽略的连带影响。

### 1.2 表头行高被就地覆盖（口径不统一的证据）

两张表都在 `th` 上覆盖了常量的内边距：

| 表 | 写法 | 实际上下内边距 |
| --- | --- | --- |
| 表 1 `logs-table.tsx:110-112` | `cn(tableHeaderCellClass, 'h-auto w-40 py-1.5')` | **6px**（不是常量的 8px） |
| 表 2 `request-logs-table.tsx:100-118` | `cn(tableHeaderCellClass, 'py-1.5')` | **6px** |

外层 `<tr className="h-8">`（32px）与 `py-1.5`（16+6×2=28px）**不吻合**——实际高度由 `h-8` 决定，
`py` 只是把内容压到中间。**两处都这么做，说明 `h-8` 才是表头的真实高度定义**，
`tableHeaderCellClass` 的 `py-2` 在表头位置上**从未生效**。

**规则**：表头高度**用 `h-8` 表达**，单元格内边距用 `py-1.5` 让位。
不要依赖 `tableHeaderCellClass` 的 `py-2`——它会被覆盖。

---

## 2. 密度：只有一套，没有密度档

Carbon 的密度刻度是 13 档（`spacing-01..13`），`[源码]` 见表
[`design-token-mapping.md`](./design-token-mapping.md) §1.3。**osw 不提供密度切换**：

| 项 | 现状 |
| --- | --- |
| 密度切换开关 | **不存在**（无 `compact` / `comfortable` 的密度 prop，无相关设置项） |
| 行高 | 表体 `py-2.5`（36/40px）、表头 `h-8`（32px），**全表统一** |
| 表格字号 | 表体由调用方定（表 1 `text-xs` 12px、表 5 `system-xs-regular` 12px、`model-ranking` `text-xs`），表头固定 11px |

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **不引入密度档位**。osw 是单窗口桌面工具，表格行数在几十到几百量级，一套密度够用；引入密度档位意味着每个单元格要有两套内边距，收益远小于成本 |
| 2 | 表格字号**必须是 12px（`text-xs` / `system-xs-*`）**，表头 11px（`system-2xs-medium`）。这是 [`design-token-mapping.md`](./design-token-mapping.md) §1.3 的 13 档体系里落在"数据密集"区间的两档 |
| 3 | **密度靠列宽与列数调，不靠行高调**。嫌挤就减列（表 2 有 11 列，是全仓最宽的），不要压行高——36px 已经是"12px 文字 + 10px 内边距"的下限 |
| 4 | **行高由最高的单元格决定**（§1.1）。往表里放徽标/图标按钮前，先算这一行会不会被撑高 |

---

## 3. 表单：`form-kit.tsx` 是唯一的表单体系

`[源码]` 实测：

| 文件 | 行数 | 引用它的文件数 | 结论 |
| --- | --- | --- | --- |
| `components/form-kit.tsx` | 228 | **28** | ✅ 唯一的表单体系 |

官方 shadcn 的 `components/ui/field.tsx`（239 行、0 个调用方）已随死代码清理删除。

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **表单用 `form-kit.tsx`**（`FormField` / `FormSwitchRow` 等），不要新造 |
| 2 | **错误文案必须与控件程序化关联**（`aria-describedby`）——当前全仓 **0 处**，是 [`design-system-accessibility.md`](./design-system-accessibility.md) §8.3 登记的**最高优先级缺口**（违反 WCAG 3.3.1 A 级） |
| 3 | **表单控件的默认高度是 32px**（`h-8`），与 `Button` 的默认档一致（[`design-system-components.md`](./design-system-components.md) §4）。表单行里按钮与输入框不等高是最容易看出来的不齐 |
| 4 | **校验时机**：错误在**提交后**或**失焦后**出现，不要在每次按键时弹（中文输入时每个拼音字母都会触发一次） |
| 5 | 表单控件的排版用 **13px**（`ui/input.tsx:7` 注释原文：**"透明描边 → 悬停/聚焦才显形，底色走 `components-input-*` token，排版用 13px"**），对应 `system-sm-*` |

---

## 4. 批量操作：**当前完全没有**

`[源码]` 实测：**5 张表里没有一张有选择列**。`Checkbox` 的使用点是
`model-test-panel.tsx`（不是表格，是一个测试任务清单）、`provider-model-row.tsx`、
`fetched-model-picker.tsx`、`provider-rule-bindings.tsx`、`provider-export-dialog.tsx`。

其中 `model-test-panel.tsx` 是**唯一实现了完整选择语义的地方**，值得作为规范来源：

| 能力 | 实现 | 位置 |
| --- | --- | --- |
| 全选 | `allTasksSelected ? t('modelTest.selection.clear') : t('common.action.selectAll')` | `:235` |
| 分组选择 | 按 provider 分组勾选 | `:258` |
| **半选（indeterminate）** | `checked={modelView.indeterminate ? 'indeterminate' : modelView.selected}` | `:283` |
| 半选的视觉 | `data-[state=indeterminate]:` 任意值语法（`ui/checkbox.tsx:36` 注释说明：**"`indeterminate` 没有对应的 Tailwind 变体，所以整份代码里「半选」一律写成 `data-[state=indeterminate]:`"**） | `ui/checkbox.tsx` |

### 4.1 表格要加批量操作时的规则（**新功能，当前不存在**）

| # | 规则 |
| --- | --- |
| 1 | **选择列放在第一列**，宽 `w-8`（与 `request-logs-table.tsx:100` 的展开列同宽，两者不同时出现） |
| 2 | **表头是"全选本页"而不是"全选全部"**，除非分页被去掉。表 1 / 表 2 都有分页（`TablePager`），跨页全选需要额外的状态与文案，**收益不足以支撑** |
| 3 | **分组时必须有半选态**，走 `data-[state=indeterminate]:`（§4） |
| 4 | **选中后出现的操作条要固定位置**（吸顶或吸底），不要插进表格里把行挤下去 |
| 5 | **危险操作（删除）在批量场景下必须二次确认**，用 `ConfirmDialog`（[`design-system-components.md`](./design-system-components.md) §2.2） |
| 6 | **操作条要能取消选择**（"取消选择"与"全不选"是两件事，前者退出选择模式） |
| 7 | **选中数要播报**：`aria-live="polite"`（[`design-system-accessibility.md`](./design-system-accessibility.md) §8.4） |

---

## 5. 空态、加载、错误：三种状态，一个组件

### 5.1 `TableStateRow` 是表格三态的统一实现

`[源码]`，`components/table-state.tsx`：

```tsx
interface TableStateRowProps {
  colSpan: number                              // 必填：跨满整行
  icon: LucideIcon                             // 必填
  title: string                                // 必填
  description?: string
  tone?: 'muted' | 'destructive'               // 枚举 prop，不是两个布尔
  action?: ReactNode                           // 重试按钮等
  className?: string
}
```

渲染成 `<tr><td colSpan className="px-4 py-14 text-center">`：
图标 22px / 描边 1.5 → 标题 `system-xs-medium` → 描述 `system-xs-regular text-text-tertiary` → `action`。

**该文件的注释写明了它的存在理由**：

> 库里的表格从 3 列到 10 列不等，所以用 `colSpan` 跨满整行，
> 避免每个表格各写一套裸 `<td className="px-4 py-12 text-center">`。

`tone="destructive"` 时标题与图标改用 `text-text-destructive`。
**"空"与"错"靠 `tone` 区分，不靠两套组件。**

### 5.2 三态的判定顺序（表 1 的实现）

`[源码]`，`logs-table.tsx:88-93`：

```
if (loading)                     → 10 行骨架
if (error && logs.length === 0)  → 错误行 + 重试按钮
if (logs.length === 0)           → 空态行（区分"筛选后为空"与"从来没有"）
否则                              → 数据行
```

**四条规则**（这张顺序表就是规范）：

| # | 规则 | 依据 |
| --- | --- | --- |
| 1 | **加载态优先于一切**：正在加载时不显示空态 | 否则每次刷新都会闪一下"暂无数据" |
| 2 | **有数据时错误不占满表格**：只有 `error && rows.length === 0` 才走错误行 | 已经有数据却把表盖掉，等于把可用的信息也藏了 |
| 3 | **空态必须分两种**："筛选后为空"（要提示怎么清筛选）与"从来没有"（要提示怎么新建） | `renderEmptyRow` 按 `filtered` 分支，文案 key 分别是 `logs.empty.filtered*` 与 `logs.empty.*` |
| 4 | **错误态必须给动作**：`action` 槽放重试按钮 | 只报错不给动作，用户只能刷新整页 |

### 5.3 骨架屏：行数是拍出来的

| 表 | 骨架行数 | 位置 |
| --- | --- | --- |
| `logs-table.tsx` | **10** | `renderLoadingRows()` 的 `Array.from({ length: 10 })` |
| `request-logs-table.tsx` | **8** | `Array.from({ length: 8 })` |

**规则**：骨架行数**不要多于该表一屏能显示的行数**，否则加载态比真实内容还长。
两个数不同是**正常**的（表 2 行高 40px、列更多，一屏装不下 10 行）。
**但骨架的每列宽度要与真实内容大致对应**——表 2 用 `h-3 w-20` / `h-3 w-28` / `h-5 w-12` 逐列给宽度，
这是正确做法；表 1 的骨架也是逐列给宽。**不要用等宽骨架**。

### 5.4 三套空态组件（现状，需收敛）

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `EmptyState` | `components/ui/empty-state.tsx` | 应用主用（**12 个文件**） |
| `InlineEmptyState` | `components/inline-empty-state.tsx` | 行内小空态（图标 20px） |
| `Empty` | `components/ui/empty.tsx` | 官方 shadcn 原语，被 `empty-state.tsx` 包了一层 |

`empty-state.tsx` 自述是 **"Compatibility wrapper built from the official shadcn Empty primitives"**。

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **表格内的空态一律用 `TableStateRow`**（它在 `<tr>` 里），不要用 `EmptyState`（它是块级容器） |
| 2 | **页面级空态用 `EmptyState`**，行内（卡片内、面板内的小区域）用 `InlineEmptyState` |
| 3 | **直接 `import { Empty } from 'ui/empty'` 视为不符合约定**——它是 `EmptyState` 的底层，不直接对业务暴露 |

---

## 6. 分页

`components/table-primitives.tsx:38-51` 的 `TablePager`：计数文案（`common.pagination.page`）+ 两个
`icon-sm` 的翻页按钮（带 `aria-label`，来自目录 `common.pagination.previous` / `next`）。
**这是全仓唯一的分页实现**——shadcn 那套页码列表式的 `ui/pagination.tsx` 从来没有被表格用过，
已随死代码清理删除。

**规则**：

| # | 规则 |
| --- | --- |
| 1 | 表格分页用 `TablePager`（`上一页 / 下一页 + 第 N / M 页`），**不用页码列表**——数据量级下页码列表没有价值 |
| 2 | 分页条**只在需要时出现**：`totalPages > 1`（`request-logs/page.tsx:61` 的 `!loading && totalPages > 1`），单页时不显示 |
| 3 | 翻页按钮在首/末页 `disabled`，且 `disabled` 态要有可访问语义（不要只靠 `opacity`，见 [`design-system-accessibility.md`](./design-system-accessibility.md) §1.4） |
| 4 | 分页状态**与筛选联动**：改筛选要回到第 1 页 |

---

## 7. 长列表的虚拟化

`[源码]`：**没有虚拟化**。表格用 `overflow-y-auto` 的容器 + 分页控制行数。

**规则**：**不要引入虚拟滚动**。分页已经把 DOM 行数控制在几十行；引入虚拟化会带来
行高测量、`sticky` 表头冲突、键盘可达性三件麻烦事，而当前的性能问题不在渲染上。

---

## 8. 落地清单

**新增一张表**：

- [ ] 用 `TableFrame` + `TableViewport` + `table-primitives.tsx` 的四个类常量
- [ ] 表头 `h-8` + `py-1.5`，表体 `py-2.5`，字号 12px（表头 11px）
- [ ] 表头 `sticky top-0 z-10`，底色是 `bg-inset` 或 `bg-card/95 backdrop-blur-sm`（与表体区分）
- [ ] 排序列表头用 `SortableHeader`（整格可点、图标位置固定、内边距只在按钮上）
- [ ] 数字列右对齐 + `tabular-nums`，并整列一致
- [ ] 机器标识列 `font-mono`
- [ ] 长文本列显式选 `truncate`（+`min-w-0`）或 `line-clamp-2`
- [ ] 三态走 `TableStateRow`，顺序是**加载 → 错误（仅当无数据）→ 空（区分筛选）→ 数据**
- [ ] 空态分"筛选后为空"与"从来没有"两种文案
- [ ] 错误态给重试动作
- [ ] 骨架屏逐列给宽度，行数不超过一屏
- [ ] 分页用 `TablePager`，`totalPages > 1` 才显示
- [ ] 加批量选择时：选择列在第一列（`w-8`）、有半选态、操作条固定位置、危险操作二次确认

**改一张表**：

- [ ] 改任何单元格高度前，先确认它会不会改整表行高（§1.1）
- [ ] 不要就地覆盖内边距常量；需要不同的内边距时**改常量**或**说明为什么这一列特殊**

---

## 9. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **表体行高的实测值** | `[未核实]` | §1.1 的 36 / 40px 是**按类常量与行高推算**的，没有在浏览器里量过。徽标、图标按钮、`whitespace-pre-wrap` 的多行单元格都会改变实际高度 |
| **Carbon 的表格密度刻度该怎么落到 osw** | `[未核实]` | [`design-token-mapping.md`](./design-token-mapping.md) §1.3 有 Carbon 的 13 档间距，但**没有 Carbon 表格行高的对照**（`@carbon/layout` 里只有 spacing / size，表格行高在 `@carbon/styles` 的组件样式里）。本文的"不引入密度档位"是**基于 osw 产品形态的判断**，不是上游对照的结论 |
| **`model-ranking` / `provider-detail` 两处裸 `<table>` 是否有意** | `[未核实]` | 前者混用了常量与裸 `<table>`，后者完全手写（`min-w-180`）。两处都没有注释说明为什么不用常量。**未判定是有意（概览页的表格更简单）还是遗漏** |
| **`rules-table.tsx` 用 `px-4 py-2` 是有意还是笔误** | `[未核实]` | 常量是 `px-3 py-2`，该表表头写 `px-4`；且它同表的表体既有 `px-4 py-2.5` 也有 `px-3 py-2.5`（每条规则的第一列与其余列不同宽）。这种"首列更宽"在其他表里也存在（`model-ranking.tsx:68` 也写 `cn(tableCellClass, 'px-4')`）——**可能是"首列对齐卡片内边距"的有意做法**，无法从代码判定 |
| **批量操作条的位置约定** | `[未核实]` | §4.1 的 7 条是**新功能的建议**，仓库里没有实现，因此没有"现有做法"可对照 |
| **骨架行数与真实首屏行数的关系** | `[未核实]` | 需要按真实窗口高度实测一屏几行。本文只给出"不超过一屏"的原则 |
