# AI 生成器约束

> 本文是 [`design-system.md`](./design-system.md) 全套文档的**执行摘要**，
> 覆盖 issue #124 的缺口：**AI 生成器约束**。
>
> **读法**：生成界面代码前读本文。它是这一套里**唯一为"机器可判定"写的一份**——
> 每条都是「允许 / 禁止 / 正确做法」的三段式，**没有形容词**。
> 需要知道"为什么"时，每节末尾指向展开细则的分册。
>
> **本文不改代码**：所有 ❌ 例子都是当前仓库里**真实存在**的写法（标了文件与行号），
> 登记为待办，不在本文执行。

## 0. 判定总则

生成任何界面代码时，按这个顺序自问：

```
1. 这个交互需要「记住用户在什么状态下按了什么」吗？   → 是：用 Radix 原语，不许手写
2. 这个值能用一个已有的语义 token 表达吗？            → 能：用它，不写字面值
3. 这个差异是「换 token 通道」还是「换结构」？        → 换通道：variant；换结构：组合
4. 这句文案会出现在界面上吗？                        → 会：进 i18n 目录
```

**四条铁律**（[`design-system.md`](./design-system.md) §全局铁律）在本文全部展开为可判定项：

| # | 铁律 | 本文对应 |
| --- | --- | --- |
| 1 | 语义命名，禁止视觉命名 | §2.1 |
| 2 | 品牌层只存在于 `styles/index.css` 的 `@theme` 与 `.dark` | §2.2 |
| 3 | 上游数值必须标来源 | §6 |
| 4 | 核不到就写「未核实」 | §6 |

---

## 1. 允许清单（白名单）

**这些可以放心用**，它们已经是设计系统的一部分：

### 1.1 组件

| 允许 | 位置 | 说明 |
| --- | --- | --- |
| `components/ui/*` 的 69 个组件 | `components/ui/` | 除 `field.tsx`（死代码）与 `chart.tsx`/`direction.tsx`（0 引用）外 |
| `components/form-kit.tsx` | 表单 | **表单必须用它**，见 §3.2 |
| `components/table-primitives.tsx` | 表格 | 四个类常量 + `TableFrame` / `TableViewport` / `TablePager` / `SortableHeader` |
| `components/table-state.tsx` 的 `TableStateRow` | 表格三态 | 加载 / 空 / 错误 |
| `components/ui/empty-state.tsx` 的 `EmptyState` | 页面级空态 | |
| `components/inline-empty-state.tsx` 的 `InlineEmptyState` | 行内空态 | |
| `components/ui/confirm-dialog.tsx` 的 `ConfirmDialog` | 确认框 | |
| `components/ui/button.tsx` 的 `Button` | 一切按钮 | 6 变体 × 8 尺寸 |

### 1.2 样式

| 允许 | 说明 |
| --- | --- |
| **`system-*` 排版实用类** | 24 个已定义（[`design-system-typography.md`](./design-system-typography.md) §1.1）。**优先用这 16 个在用的** |
| **语义色 token 类** | `bg-background` `text-foreground` `bg-card` `bg-inset` `border-module-border` `border-panel-border` `bg-state-base-hover` `text-text-{primary,secondary,tertiary,quaternary}` `text-text-{destructive,success,warning}` `bg-util-colors-*`（仅节点图标色块）…完整清单见 [`design-system-tokens.md`](./design-system-tokens.md) §2 |
| **圆角** | `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-2xl` / `rounded-3xl` / `rounded-4xl`（派生自 `--radius`）；浮层内用 `workflow-ui-surface` 作用域 |
| **间距** | Tailwind 默认刻度 + `gap-*` / `p-*` / `m-*`。**任意值只在 [`design-token-mapping.md`](./design-token-mapping.md) §2.2 列出的例外场合** |
| **布局** | `flex` / `grid` / `min-w-0` / `truncate` / `line-clamp-*` / `tabular-nums` / `font-mono` |
| **状态变体** | `hover:` / `focus-visible:` / `disabled:` / `aria-invalid:` / `data-[state=…]:` / `data-checked:` / `has-*` |
| **图标** | `lucide-react`，尺寸取 12 / 14 / 16 / 20 / 24（[`design-system-icons.md`](./design-system-icons.md) §2.2） |

### 1.3 结构

| 允许 | 说明 |
| --- | --- |
| 页面放 `packages/console/source/pages/<domain>/page.tsx` | 11 个域：`client-config` `logical-models` `logs` `model-management` `onboarding` `overview` `request-logs` `request-rewrite-rules` `router` `runtime-settings` `tray` |
| 页面私有组件放 `pages/<domain>/components/` | |
| 页面私有逻辑放 `pages/<domain>/lib/` `hooks/` `store.ts` `service.ts` | |
| 导航项加进 `routing/navigation.ts` 的 `appNavigationItems` | |
| 路由常量在 `routing/routes.ts` | |

---

## 2. 禁止清单（黑名单）

### 2.1 视觉命名（铁律 1）

| ❌ 禁止 | ✅ 正确 | 现状（待改） |
| --- | --- | --- |
| `text-zinc-900` | `text-text-primary` | `bill-content.tsx:92` |
| `bg-red-500` / `bg-orange-500` / `bg-amber-500` … | `bg-util-colors-*` 或登记分类色板 token | `pages/overview/lib/format.ts:85-94`（8 处）、`failure-reasons.tsx:15-24`（8 处）、`node-meta.ts:140` |
| `border-amber-300/70` `bg-amber-50/80` | 登记 `workflow-node-note-*` | `workflow-node.tsx:66` |
| `text-quaternary` ❌ / `text-quaternary` ✅ | 语义命名是对的，**保持** | — |

**判据**：类名里出现 Tailwind 调色板名（`slate` `gray` `zinc` `red` `orange` `amber` `yellow` `green` `blue` `indigo` `violet` `pink` `rose` …）+ 数字色阶 → **违规**。
共 **34 处**（生产 29 / 测试 5），见 [`design-system-tokens.md`](./design-system-tokens.md) §3.4。

### 2.2 字面值与任意值（铁律 2）

| ❌ 禁止 | ✅ 正确 |
| --- | --- |
| `#fff` `#101828` `rgb(16 24 40)` | 用一个 `--color-*` token |
| `text-[13px]` | `system-sm-medium`（13px/16px）——[`design-system-typography.md`](./design-system-typography.md) §2.2 |
| `text-[0.8rem]`（12.8px） | `system-xs-*` 或 `system-sm-*` |
| `rounded-[5px]` `rounded-[7px]` | `rounded-sm` / `rounded-md` / `rounded-lg` |
| `!important` 覆盖 token | 改 token，或加一层语义 |
| `dark:bg-amber-400/25` | 一组 token，明暗值都写进 `.dark` |

**例外**（可以字面值，但**必须注释属于哪一类**，[`design-system-tokens.md`](./design-system-tokens.md) §3.3）：
① 导出场景层（账单 PNG）② 插图场景（纸张、打印机预览）③ 品牌资产（标志渐变）④ 库内部约定（Recharts 的 attribute 选择器）。

### 2.3 手写交互（铁律 3 —— Radix 红线）

**以下任何一条都不许手写**（[`design-system.md`](./design-system.md) 第一层）：

| ❌ 禁止手写 | ✅ 正确 |
| --- | --- |
| 焦点陷阱与焦点归还 | Radix `Dialog` / `Popover` / `DropdownMenu` / `Command` |
| `Esc` 逐层关闭 | Radix 原语 |
| 方向键 / `Home` / `End` / `Tab` 顺序 | Radix 原语 |
| `aria-*` 完整标注 | Radix 原语 |
| 滚动锁与 `body` 滚动位置恢复 | Radix 原语 |
| `prefers-reduced-motion` 降级 | Radix 原语 + `motion-reduce:` |
| IME 组合态（`compositionstart` / `compositionend`） | Radix 原语或原生表单，**不要手写** |

**`role="button"` 的准入**（[`design-system-accessibility.md`](./design-system-accessibility.md) §4.4）：
**优先顺序是真元素 → Radix 原语 → 三件套齐全的 `role="button"`**。
三件套 = `tabIndex` + `Enter`/`Space`（`Space` 要 `preventDefault()`）+ `:focus-visible`。

❌ 现状（待改，共 5 处）：

| 位置 | 问题 |
| --- | --- |
| `pages/router/components/workflow-node.tsx:56-61` | `role="button"` + `tabIndex={0}` + 手写 `Enter`/`Space` → **应改成真 `<button>`** |
| `pages/request-logs/components/request-log-detail-row.tsx:272-277` | 同上 |
| `components/model-test-panel.tsx:577-581` | 同上 |
| `pages/router/rules/field-path-input.tsx:81-89` | **手写 combobox**（`:70` 还有 `aria-controls`）→ 改用 `components/ui/combobox.tsx` |
| `pages/router/rules/landing-editor.tsx:152-168` | 手写 combobox + 隐藏的 `Backspace 删除` 交互 |

### 2.4 其他禁止项

| ❌ 禁止 | 理由 | 分册 |
| --- | --- | --- |
| 硬编码 CJK 文案 | `no-hardcoded-cjk` ESLint 规则会拦（`packages/console/scripts/eslint-plugin-i18n.mjs`） | [`design-system-copy.md`](./design-system-copy.md) |
| `aria-labelledby` / `aria-describedby` 缺失的表单错误 | **当前全仓 0 处**，违反 WCAG 3.3.1（A 级） | [`design-system-accessibility.md`](./design-system-accessibility.md) §8.3 |
| 触控目标 < 24×24px | WCAG 2.5.8（AA），**无例外** | 同上 §2 |
| `dark:` + 调色板 / `dark:` + 任意值 | 违规两次 | [`design-system-theming.md`](./design-system-theming.md) §2.3 |
| 引入第二个图标库 | 图标库只有 `lucide-react` | [`design-system-icons.md`](./design-system-icons.md) §1 |
| 引入虚拟滚动 | 分页已把 DOM 行数控制住 | [`design-system-data-display.md`](./design-system-data-display.md) §7 |
| 引入密度档位 | 单窗口桌面工具，一套密度够用 | 同上 §2 |
| 新增 `components/ui/*` 而未过 7 条门槛 | 见 [`design-system-components.md`](./design-system-components.md) §6 | 同左 |
| 照抄 `components/ui/field.tsx` | **它是死代码（0 引用）** | 同上 §1 |
| 照抄 `components/ui/table.tsx` 当公共基础 | 表格的公共基础是 `table-primitives.tsx` | [`design-system-data-display.md`](./design-system-data-display.md) §0 |
| 用 `EmptyState` 做表格空态 | 表格空态用 `TableStateRow`（在 `<tr>` 里） | 同上 §5.4 |
| 感叹号 / 人称 / 产品自称 | 用语规范 | [`design-system-copy.md`](./design-system-copy.md) §1.3 |
| "请稍后重试"这类无信息量的建议 | 建议必须可执行 | 同上 §3.2 |

---

## 3. 正确做法对照表

### 3.1 按钮

```tsx
// ❌ 就地写一套按钮外观
<button className="rounded-md bg-blue-500 px-3 py-2 text-white hover:bg-blue-600">保存</button>

// ❌ 借 components-* token 装作是按钮
<div className="bg-components-button-primary-bg px-3 py-2">保存</div>

// ✅
<Button variant="default" size="default">{t('common.action.save')}</Button>
```

| 规则 | 依据 |
| --- | --- |
| `components-button-*` token **只允许 `components/ui/button.tsx` 使用**，别的组件要按钮外观就**渲染一个 `<Button>`** | [`design-system-components.md`](./design-system-components.md) §5.1 |
| 默认尺寸是 `default`（32px），**与 `Input` 对齐** | 同上 §4 |
| 需要透出按钮样式给别的组件时，**从底层 props 类型取**：`variant?: ComponentProps<typeof Button>['variant']`，**不要重新声明联合类型** | 同上 §2.2 |

### 3.2 表单

```tsx
// ❌ 用 ui/field.tsx（死代码）
import { Field, FieldError } from '@/components/ui/field'

// ❌ 自己拼 label + input + 错误
<div>
  <label>名称</label>
  <input className="rounded border px-2 py-1" />
  <p className="text-red-500">必填</p>
</div>

// ✅ 用 form-kit，且错误与控件程序化关联
import { FormField } from '@/components/form-kit'
<FormField
  label={t('…')}
  error={error}
  aria-describedby={errorId}   // ← 当前全仓 0 处，是必须补的一环
/>
```

| 规则 | 依据 |
| --- | --- |
| 表单体系是 `components/form-kit.tsx`（**28 个文件**在用） | [`design-system-data-display.md`](./design-system-data-display.md) §3 |
| 控件高度 32px（`h-8`）、排版 13px（`system-sm-*`） | 同上 |
| 校验在提交后或失焦后，**不要每次按键**（中文输入每个拼音字母都会触发） | 同上 |
| 错误必须 `aria-describedby` 关联到控件 | [`design-system-accessibility.md`](./design-system-accessibility.md) §8.4 |

### 3.3 状态色

```tsx
// ❌ 三个布尔 → 会产生「两个都为 true」的非法组合
<Card isMuted isDestructive />

// ❌ 视觉命名
<span className="bg-red-500/10 text-red-600">失败</span>

// ✅ 枚举 prop
<TableStateRow tone="destructive" … />

// ✅ 语义 token
<span className="bg-destructive/10 text-text-destructive">失败</span>
```

| 规则 | 依据 |
| --- | --- |
| 枚举用**单个 prop**（`tone?: 'muted' \| 'destructive'`），不用多个布尔 | [`design-system-components.md`](./design-system-components.md) §3 规则 5 |
| 状态色走 `state-*` / `text-{success,warning,destructive}` / `bg-{success,warning,info}` | [`design-system-tokens.md`](./design-system-tokens.md) §2.2 |

### 3.4 表格

```tsx
// ❌ 手写内边距，与常量不一致
<th className="px-4 py-2">名称</th>
<td className="px-4 py-2.5">…</td>

// ❌ 用 EmptyState 做表格空态
<tbody><tr><td><EmptyState title="暂无数据" /></td></tr></tbody>

// ✅
import { tableHeaderClass, tableHeaderCellClass, tableCellClass, TableFrame } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
<TableFrame>
  <thead className={cn(tableHeaderClass, 'sticky top-0 z-10 bg-inset')}>
    <tr className="h-8"><th className={cn(tableHeaderCellClass, 'py-1.5')}>名称</th></tr>
  </thead>
  <tbody><TableStateRow colSpan={3} icon={SearchX} title={t(…)} /></tbody>
</TableFrame>
```

| 规则 | 依据 |
| --- | --- |
| 表头 `h-8` + `py-1.5`，表体 `py-2.5`，字号 12px（表头 11px） | [`design-system-data-display.md`](./design-system-data-display.md) §1 |
| 三态顺序：**加载 → 错误（仅当无数据）→ 空（区分筛选）→ 数据** | 同上 §5.2 |
| 数字列右对齐 + `tabular-nums`，且整列一致 | [`design-system-typography.md`](./design-system-typography.md) §6.2 |
| 长文本列显式选 `truncate`（+`min-w-0`）或 `line-clamp-2` | 同上 §7.2 |

### 3.5 图标

```tsx
// ❌ 14 种尺寸里随手挑一个
<Search size={13} />
<Search size={11} />

// ❌ 手写 aria-hidden（lucide 会自动加）
<Search aria-hidden className="size-4" />

// ✅ 容器里不写尺寸（父类给 16px）
<Button><Search />搜索</Button>

// ✅ 离开容器就显式取五档之一
<Search size={14} className="shrink-0" />
```

| 规则 | 依据 |
| --- | --- |
| 尺寸只取 **12 / 14 / 16 / 20 / 24**，且**跟着同行文字字号走** | [`design-system-icons.md`](./design-system-icons.md) §2.2、§4.2 |
| 描边默认 2；≥20px 用 1.5；深色玻璃底用 1.75 | 同上 §3.2 |
| 装饰图标不写 `aria-hidden`；纯图标按钮必须 `aria-label` 且走目录 | 同上 §6 |

### 3.6 文案

```tsx
// ❌ 硬编码 + 感叹号 + 人称 + 无信息量的建议
toast.error('哎呀，你的保存失败了，请稍后重试！')

// ❌ key 拼接句子
t('save') + ' ' + name + ' ' + t('failed')

// ✅ 整句作为一条消息，用 placeholder 传参
toast.error(t('errors.SAVE_FAILED', { name }))
// 目录里：'errors.SAVE_FAILED': '「{name}」保存失败，请检查名称是否重复'
```

| 规则 | 依据 |
| --- | --- |
| 进 `packages/contracts/source/i18n/catalogs/`，中英同时写 | [`design-system-copy.md`](./design-system-copy.md) §0 |
| 按钮 ≤4 汉字，状态标签 ≤4 汉字，hint ≤80 字；**无感叹号、无人称、无产品自称** | 同上 §1.3、§2 |
| 错误文案：**发生了什么**；超过 80 字要加**后果**；有建议就必须可执行 | 同上 §3 |
| 术语固定：供应商 / 供应商模型 / 逻辑模型 / 请求记录 / 尝试 / 切换 | 同上 §5 |

### 3.7 状态与交互

```tsx
// ❌ 用一个 div 假装可点
<div role="button" tabIndex={0} onClick={open} onKeyDown={e => e.key === 'Enter' && open()}>…</div>

// ✅ 真元素
<button type="button" onClick={open}>…</button>

// ❌ token 表达不了的差异硬写 dark:
<span className="bg-amber-300/70 dark:bg-amber-400/25">命中</span>

// ✅ 一组 token，明暗值写进 .dark
<span className="bg-search-hit-bg">命中</span>
```

| 规则 | 依据 |
| --- | --- |
| 能用 token 就不用 `dark:`；用了必须注释说明为什么 token 表达不了 | [`design-system-theming.md`](./design-system-theming.md) §2.3 |
| 新代码读明暗用 `useResolvedAppearance().theme`，**不要读 `<html>` 的类名** | 同上 §0.3 |
| 动效必须命中 `motion-reduce:` 或 `@media (prefers-reduced-motion)` 之一，且**降级后信息仍在** | [`design-system-accessibility.md`](./design-system-accessibility.md) §5 |

---

## 4. 常见任务的配方

### 4.1 新增一个页面

```
1. pages/<domain>/page.tsx                        ← 页面
2. pages/<domain>/components/*.tsx                ← 私有组件
3. pages/<domain>/service.ts / store.ts / hooks/  ← 逻辑（不要写在 .tsx 里）
4. routing/routes.ts 加路径常量
5. routing/navigation.ts 的 appNavigationItems 加导航项（icon 从 lucide-react 取，labelKey 用 UiCatalogKey）
6. i18n 目录加 nav.page.<domain> 与页面文案
7. 若页面有标题：<h1 className="system-xl-semibold text-text-primary">
```

**注意**：`route-mode-switch.tsx:20` 的注释提到页头高度的对齐问题——
**`system-xl-*` 的字号是 16px、行高 24px**，与相邻控件的高度差会让页头比别的页面高一点点。
新增页头时对一下相邻页面。

### 4.2 新增一个表格

见 §3.4 + [`design-system-data-display.md`](./design-system-data-display.md) §8 的 13 条清单。

### 4.3 新增一个图标按钮

```tsx
// ✅
<Button variant="ghost" size="icon-sm" aria-label={t('…')}>
  <Trash2 size={14} />
</Button>
```

`icon-*` 四档的高度 = 24 / 28 / 32 / 36px。
**`icon-xs`（24px）恰好等于 WCAG 2.5.8 的下限，零余量**——
用在表格行内时不要再缩小视觉。

### 4.4 新增一个语义色 token

必须同时满足 4 个条件（[`design-system-tokens.md`](./design-system-tokens.md) §6）：

1. 现有 token 组合不出来
2. 它是**语义**（能被一句话描述），不是某个具体位置的颜色
3. 有 **≥2 个调用点**
4. 能说清它属于哪一层（A 引用 B / C 直写 / 品牌层）

然后走 §3.2 的明暗三分支流程，并更新 tokens 文档 §2 的清单。

---

## 5. 提交前自检

```bash
cd packages/console/source

# 视觉命名（期望：只剩已登记的 34 处，不增加）
rg -o --no-filename '\b(bg|text|border|ring|from|to|via|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}' --glob '*.ts' --glob '*.tsx' . | wc -l

# 字面色值（期望：44）
rg -o --no-filename '#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)' --glob '*.tsx' . | wc -l

# 任意像素（口径见 typography §9）
rg -o --no-filename '\[[0-9.]+px\]' --glob '*.tsx' . | wc -l

# 字号任意值（期望：40，其中 25 个是 13px）
rg -o --no-filename '\btext-\[[0-9.]+(px|rem|em)\]' --glob '*.tsx' . | wc -l

# dark: 数量（期望：≤56，且无调色板）
rg -o --no-filename '\bdark:' --glob '*.tsx' . | wc -l
rg -n 'dark:(bg|text|border|ring)-(slate|gray|zinc|red|orange|amber|yellow|green|blue|indigo|violet|pink|rose)' --glob '*.tsx' .   # 必须为空

# 明暗覆盖（B 层 key 必须一致，期望：无输出）
diff <(sed -n '541,595p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort) \
     <(sed -n '597,641p' styles/index.css | rg -o '^\s*--([a-z0-9-]+):' -r '$1' | sort)

# 焦点环宽度（期望：只有 ring-2 一种）
rg -o --no-filename 'focus-visible:ring-(\[3px\]|[0-9])' --glob '*.tsx' . | sort | uniq -c

# 手写键盘逻辑（期望：只有已登记的 8 个文件）
rg -n 'onKeyDown|addEventListener\(.keydown' --glob '*.tsx' --glob '*.ts' . | grep -v components/ui/

# 无障碍关联（期望：不再是 0）
rg -c 'aria-labelledby|aria-describedby' --glob '*.tsx' . | wc -l

# 目标尺寸（期望：新增的都不小于 24px）
rg -o --no-filename '\bsize-(5|6|7|8|9|10|11)\b' --glob '*.tsx' . | sort | uniq -c
```

**约束**：跑 `pnpm lint`。`no-hardcoded-cjk` 会拦住硬编码中文。

---

## 6. 不确定时的处置

| 情况 | 默认动作 |
| --- | --- |
| **不确定用哪个 token** | 看相邻的同类元素在用什么，用同一个。**不要引入新 token**（新 token 要过 4 条门槛） |
| **不确定该不该写 `dark:`** | 不写。先看能不能在 `.dark` 里给 token 加覆盖 |
| **不确定这个交互能不能手写** | 当成不能。先用 Radix 原语搭，搭不出来说明需求本身有问题 |
| **不确定文案该多长** | 按 [`design-system-copy.md`](./design-system-copy.md) §2 的上限，**取更短的那个** |
| **不确定这个值（间距/尺寸）** | 用现有的刻度值（Tailwind 默认 + `system-*`）。**不要写任意值** |
| **不确定该不该新增组件** | 不新增。先用现有组件组合 |
| **上游数值核不到** | 写进「未核实」，**不当结论用**（铁律 4）。每份分册末尾都有「未核实」节 |
| **拿不准某一项** | 在 PR 描述里写"这一项不确定，理由是…"，**不要沉默地猜** |

---

## 7. 本文的证据边界

本文**没有独立的新事实**——所有数字都来自各分册，且都能用 §5 的命令复现：

| 数字 | 出处 |
| --- | --- |
| 调色板类名 34 处 | [`design-system-tokens.md`](./design-system-tokens.md) §3.4 |
| 字面色值 44 处 | 同上 §3.1 |
| 任意像素 78 / 104 的口径差异 | [`design-system-typography.md`](./design-system-typography.md) §9 |
| 字号任意值 40 处 | 同上 §2.2 |
| `dark:` 56 处 / 22 个文件 | [`design-system-theming.md`](./design-system-theming.md) §1.4 |
| B 层 39 / C 层 104 / D 层 82 / 未覆盖 22 | 同上 §1.2、§1.3 |
| 手写键盘逻辑 8 个文件 | [`design-system-accessibility.md`](./design-system-accessibility.md) §4.3 |
| `aria-labelledby` / `aria-describedby` 0 处 | 同上 §8.2 |
| `system-*` 24 定义 / 16 在用 | [`design-system-typography.md`](./design-system-typography.md) §1.1 |
| 图标 14 档 | [`design-system-icons.md`](./design-system-icons.md) §0 |
| 5 张表 / 三种实现 | [`design-system-data-display.md`](./design-system-data-display.md) §0 |

**未核实项的完整清单**在各分册末尾，共 **56 项**（tokens 5 / components 4 / accessibility 7 /
typography 6 / icons 5 / data-display 7 / copy 6 / theming 7 / colors 9）。
本文不重复列举，但延续同一条规则：**未核实项不进结论、不写成规则**。
