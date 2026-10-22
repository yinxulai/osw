# 无障碍基线

> 本文是 [`design-system.md`](./design-system.md) 第一层（行为层）的**可执行基线**，
> 覆盖 issue #124 的缺口：**无障碍基线**。
>
> [`design-system.md`](./design-system.md) 原文的"评审清单"只有 6 条**提问**
> （"触控目标是否 ≥ 44px？"）。本文把它扩成**可执行基线**：每条给出
> **判据 → 数值 → 现状 → 检查方法 → 例外**，让评审能直接判"过/不过"，不用再讨论定义。
>
> **本文不改代码**：现状一律标注，缺口登记为待办。

## 0. 依据与证据规则

标准依据为 **WCAG 2.2**（`[文档]`，`https://www.w3.org/TR/WCAG22/`）。
本文引用的每一条都带**成功准则编号 + 等级 + 原文数值**，均已逐条核对原文。

| 标签 | 含义 |
| --- | --- |
| `[文档]` | WCAG 2.2 原文 |
| `[源码]` | 本仓库读出的原文（计数、类名、行号） |
| `[未核实]` | 抓不到或无法判定——**不作为结论依据** |

**等级口径**：本文的**准入线是 AA**；`AAA` 的条目只作目标，不作出厂门槛（WCAG 官方
即不要求全站达到 AAA）。凡引用 AAA 条目，文中明确标注。

---

## 1. 对比度

### 1.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **1.4.3 Contrast (Minimum)** | AA | 正文 **≥ 4.5:1**；**大号文字 ≥ 3:1** |
| **1.4.11 Non-text Contrast** | AA | **UI 组件的边界与状态** ≥ 3:1（对相邻颜色）；非活动组件除外 |

**"大号文字"的定义**（`[文档]`，WCAG 2.2 术语表 `large scale (text)`）：
原文为 "at least **18 point** or **14 point bold**, or font size that would yield
equivalent size for **Chinese, Japanese and Korean (CJK) fonts**"。

> ⚠️ 术语表**给出了 CJK 的等价条款，但没有给出 CJK 的具体数值**。因此
> "中文的多大字号算大号文字"**在标准里没有可直接引用的数字** → 见 §10 未核实项。
> **本条的处置**：osw 的界面字号集中在 11–16px，**远离任何大号文字阈值**，
> 所以**一律按 4.5:1 要求**，不需要判断是否属于大号文字。

### 1.2 规则

| # | 规则 | 判据 |
| --- | --- | --- |
| 1 | 所有正文文字 ≥ **4.5:1**（对实际背景色，不是对"设计稿上的那个白"） | 因为 osw 字号全部 ≤16px，**没有大号文字的豁免** |
| 2 | 控件的**边界**与**状态** ≥ **3:1** | 勾选框描边、输入框边界、开关轨道、滑杆手柄都算 |
| 3 | 对比度必须在**明暗两套**下分别满足 | 见 [`design-system-theming.md`](./design-system-theming.md) |
| 4 | **不要用 alpha 叠色来表达禁用态** | alpha 会同时改变前景与背景，明暗两套无法各自校正——`disabled:opacity-50` 属此类，见 [`design-token-mapping.md`](./design-token-mapping.md) §6.3 第 2 条 |

### 1.3 仓库里已有的正确做法（可作范例）

`components/ui/checkbox.tsx:15-28` 的注释是一份**完整的对比度论证**，值得作为写法范例：

> 未选中态的描边不能用 `border-input`：暗色下它是 `hsl(0 0% 16%)`（≈ `#292929`），
> 而它坐的卡面是 `--card` 12%（≈ `#1f1f1f`）—— 两者只差 **1.1:1**，等于没画。
> …
> 改用 `text-quaternary`（亮 `rgb(16 24 40/0.5)` / 暗 `rgb(200 206 218/0.5)`）：
> 它对这个 16px 小方块是 **3.5:1**，正好越过 WCAG 1.4.11 对控件边界要求的 3:1。

**要固化的是这个论证方式**：写清"哪个值对哪个底色、算出来多少、对比哪条准则的哪个数"。
`[源码]` 该段注释里的 `#292929` / `#1f1f1f` / `rgb(…)` 是**注释文本**，不是使用中的字面色值。

同样的范式还写在 `styles/index.css:147-150`（`text-quaternary` 的 1.9:1 / 3.4:1 / 5:1 三档论证）
与 `:233-237`（输入域必须比所在层更深的 91.4% → 95.2% → 98.4% 三段台阶）。

### 1.4 待补的可访问性缺口（登记）

| 缺口 | 位置 | 说明 |
| --- | --- | --- |
| **`disabled:opacity-50` 全局压暗** | `button.tsx:8` 等 | 违反规则 4。alpha 压暗后前景/背景对比度同时变化，暗色下无法保证 4.5:1。`design-token-mapping.md` §6.3 已列为缺失格子 |

---

## 2. 目标尺寸（触控与指针）

### 2.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **2.5.8 Target Size (Minimum)** | **AA**（WCAG 2.2 新增） | 指针目标 **≥ 24 × 24 CSS px**；例外：间距满足"以 24px 直径圆居中于每个目标外框，圆互不相交" |
| **2.5.5 Target Size (Enhanced)** | AAA | **≥ 44 × 44 CSS px** |

**Primer 的对应数值**（`[源码]`，`@primer/primitives@11.10.0` → `functional/size/size.json5`）：
`control.minTarget.fine = 16px`（鼠标）、`control.minTarget.coarse = 44px`（触控）。

### 2.2 osw 的取值（这里是原清单最容易误读的一处）

[`design-system.md`](./design-system.md) 原清单写的是"触控目标是否 ≥ 44px"。
**44px 不是 AA 要求，是 AAA（2.5.5）与 Primer 的粗指针值**。AA 的下限是 **24px**。
两者都要，但含义不同：

| 场景 | 下限 | 依据 |
| --- | --- | --- |
| **osw 的主要场景**：桌面单窗口 + 鼠标（细指针） | **24 × 24px** | WCAG 2.2 **2.5.8 (AA)** |
| **密集区**（表格行内操作、工具条） | **24 × 24px**，且目标之间留够间距 | 2.5.8 的 spacing 例外 |
| **主要操作 / 触控可达目标** | **44 × 44px** | WCAG 2.2 **2.5.5 (AAA)** = Primer `minTarget.coarse` |
| **正文里的行内链接** | 不适用（2.5.8 有 inline 例外） | — |

**判定规则**：

| # | 规则 |
| --- | --- |
| 1 | 任何可点元素 ≥ **24×24px**。**这条没有例外**（间距例外要求目标之间互不相交，密集工具栏通常不满足） |
| 2 | 主操作（提交、确认、危险操作）≥ **44×44px** 的目标区域 |
| 3 | 视觉尺寸小于下限时，用**透明命中区扩展**而不是放大视觉 |

### 2.3 现状（实测）

| 项 | 结果 |
| --- | --- |
| `size-11`（44px 方形） | **0 处** |
| 精确的 `h-11`（44px） | **0 处** |
| `min-h-11` | **7 处**，全在 `components/ui/questionnaire.tsx`（`:109,169,200,223,248,273,298`），且其中 `:169` 起还带 `sm:min-h-0` / `sm:min-h-8` 覆盖 |
| `pointer: coarse` / `any-pointer` 媒体查询 | **不存在**（0 处） |
| 命中区扩展 | Radix 原语用 `after:absolute after:-inset-x-3 after:-inset-y-2`（checkbox / switch / radio）。以 16px 的勾选框算：16 + 12×2 = **40px 宽、16 + 8×2 = 32px 高** |

**结论**：osw **只在问卷组件里**表达过 44px 下限，其余组件没有触控目标的概念。
因为 osw 是桌面鼠标产品，**24px 是可接受的下限**；但 `questionnaire.tsx` 的做法（用
`min-h-11` 且在小屏收紧）说明**这条规则是有人知道的，只是没写下来**——本文把它写下来。

### 2.4 待补缺口

| 缺口 | 说明 |
| --- | --- |
| **无粗指针分支** | 0 处 `pointer: coarse`。当前不需要（桌面产品），但**一旦出现触控场景**（如未来的移动端伴侣），要有统一分支而不是逐处改 |
| **密集区未核算** | 表格行内操作按钮（`icon-xs` = `size-6` = 24px）**恰好等于下限**，无余量。`size-6` 的图标按钮在设计上就是 24px，**满足 2.5.8 但零余量**——任何视觉缩小都会破线 |

---

## 3. 焦点可见

### 3.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **2.4.7 Focus Visible** | AA | 键盘焦点必须有可见指示 |
| **2.4.11 Focus Not Obscured (Minimum)** | AA（2.2 新增） | 获得焦点时，组件**不得被作者创建的内容完全遮挡** |
| **2.4.13 Focus Appearance** | AAA | 焦点指示的最小面积与对比度（本文作目标，不作出厂门槛） |

### 3.2 现状：**宽度四种、颜色五种**（实测）

`focus-visible:` 共 **140 处、41 个文件**。写法并不统一：

**宽度**：

| 宽度 | 出现在 |
| --- | --- |
| `ring-2` | 主用：`button` `switch` `badge` `select` `tabs` `sidebar` `app-sidebar` `breadcrumbs` `info-hint` `table-primitives` `route-mode-switch` `workflow-button` `rule-editor-panel` `onboarding-topbar` … |
| `ring-3` | `accordion` `checkbox` `radio-group` `native-select` `questionnaire` `interactive-hover-button` `navigation-menu` |
| `ring-[3px]`（任意值） | `item.tsx:37` `scroll-area.tsx:19` `toggle.tsx:8` |
| `ring-1` | `resizable.tsx:38` |

**颜色**：

| 颜色 | 出现在 |
| --- | --- |
| `ring-state-accent-solid` | 主用（与 token 一致 ✅） |
| `ring-ring/50` | `checkbox` `accordion` `radio-group` `item` `toggle` `native-select` `navigation-menu` `scroll-area` `interactive-hover-button` |
| `ring-destructive/20` | `button` 的 `destructive` 变体；以及各组件 `aria-invalid` |
| `ring-primary/40` | `pages/onboarding/steps/add-model-step.tsx:33,47` |
| `ring-white/35` | `pages/overview/components/receipt-controls.tsx:47` |

**全局兜底**（`styles/index.css:683-689`）：

```css
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 1px solid hsl(var(--ring));
  outline-offset: 2px;
}
```

> **`components/ui/input.tsx:15` 的根类里没有 `focus-visible:` 环**，它**依赖这条全局规则**。
> 这是有意还是遗漏无法判定 → 见 §10 未核实项。

**刻意抑制**：`components/ui/input-group.tsx:123,139` 的 `focus-visible:ring-0`（组合控件里
焦点环由外层 `has-[[data-slot][aria-invalid=true]]` / `has-focus-visible` 承担）。

### 3.3 归一规则

| # | 规则 | 说明 |
| --- | --- | --- |
| 1 | **宽度统一 2px** | 与 [`design-token-mapping.md`](./design-token-mapping.md) §6.1 的 Primer `focus.json5` 原文一致：`outline: 2px`。新增 token `--focus-ring-width: 2px`（映射文档 §7.4 已登记） |
| 2 | **颜色统一走一个 token**，且按语义分档 | 通用 `state-accent-solid`；危险操作 `destructive`。**不要**用 `/20`、`/40`、`/50` 这类 alpha 后缀——它们让同一件事有五种写法 |
| 3 | **禁用任意值写法** | `ring-[3px]`（3 处）→ `ring-2` |
| 4 | **不要靠全局 `outline` 兜底** | 组件必须自带 `focus-visible:`。全局规则是**保险**，不是实现 |
| 5 | **偏移量明确** | 全局规则用 `outline-offset: 2px`；React Flow 节点用 `outline-offset: 4px`（`index.css:805-808`）。两者不同是有意的（节点在画布上需要更大间隙），但**必须各自有注释** |

**归一后要动的文件**（按 §5.2 的频次）：`ring-3` 的 7 个组件 + `ring-[3px]` 的 3 处 + `ring-1` 的 1 处；
`ring-ring/50` 的 9 个组件；`ring-primary/40` 2 处；`ring-white/35` 1 处。

### 3.4 2.4.11 Focus Not Obscured 的具体风险

osw 有三类**作者创建的内容**会遮挡焦点：

| 风险 | 位置 | 说明 |
| --- | --- | --- |
| **sticky 表头** | `logs-table.tsx:110-112`、`request-logs-table.tsx:100`（`sticky top-0 z-10`） | 滚动时获得焦点的行可能被 sticky 表头压住。**待核** |
| **吸底操作栏** | `node-action-bar.tsx`（`z` 层较高） | 画布节点获得焦点时可能被操作栏遮挡 |
| **浮层压在触发元素上** | 所有 `position: fixed` 的 portal 浮层 | Radix 默认处理了这个问题（打开浮层时焦点在浮层内），但**自写的浮层**不保证 |

**规则**：任何 `sticky` / `fixed` 的覆盖层，必须保证**被聚焦的元素仍有一部分可见**
（2.4.11 的原文是 "not **entirely** hidden"）。检查方法见 §9。

---

## 4. 键盘完整性

### 4.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **2.1.1 Keyboard** | A | 所有功能可用键盘操作 |
| **2.1.2 No Keyboard Trap** | A | 焦点不能被永久困住 |
| **2.4.3 Focus Order** | A | 焦点顺序保持意义与可操作性 |
| **2.5.7 Dragging Movements** | AA（2.2 新增） | 拖拽操作必须提供**非拖拽的替代方式** |

### 4.2 红线（继承自总纲）

[`design-system.md`](./design-system.md) 原文的 7 条红线在本节**原样生效**，不在此重复。
本节只补**边界**：这些行为全部来自 Radix 原语，**不允许手写**。

### 4.3 现状：手写键盘逻辑的 8 个文件（实测）

`Esc` / 方向键 / `Home` / `End` / `Tab` 的**手写处理：0 处** ✅（符合红线）。
但**手写的 `Enter` / `Space` / `Delete` / `Backspace`：8 个文件**：

| # | 文件 | 手写内容 | 性质 |
| --- | --- | --- | --- |
| 1 | `components/settings-number-row.tsx:60-62` | `Enter` → commit 数字输入 | **合理**：这是对原生 `<input>` 的补充，不是按钮角色 |
| 2 | `pages/router/components/workflow-node.tsx:56-61` | `role="button"` + `tabIndex={0}` + `Enter`/`Space` → `onOpen` | **违反红线**：见 §4.4 |
| 3 | `pages/request-logs/components/request-log-detail-row.tsx:272-277` | 同上模式（`role="button"` 行） | **违反红线**：见 §4.4 |
| 4 | `components/model-test-panel.tsx:577-581` | `Enter`/`Space` → 切换行展开 | **违反红线**：见 §4.4 |
| 5 | `pages/request-logs/components/request-contents-toolbar.tsx:42-46` | `Enter` → 跳下一个/上一个匹配 | **合理**：工具条输入框的快捷键（但需与 2.1.4 单字符快捷键区分） |
| 6 | `pages/router/rules/field-path-input.tsx:81-89` | `Enter` → 选中第一个可见项 | **违规**：这是**手写的 combobox**（同文件 `:70` 还有 `aria-controls`）。应改用 `components/ui/combobox.tsx` |
| 7 | `pages/router/rules/landing-editor.tsx:152-168` | `Enter` 选中 + **空输入时 `Backspace` 删除最后一个** | **违规**：同上的手写 combobox，且 `Backspace 删除` 是无可见提示的隐藏交互 |
| 8 | `pages/router/use-workflow-studio.ts:354-361` | 全局 `window` 监听 `Delete`/`Backspace` 删除选中节点 | **需注意**：已 guard `isContentEditable` / `EDITABLE_TAGS`，但全局监听会与输入框冲突的风险始终存在 |

### 4.4 关键规则：`role="button"` 三件套

第 2、3、4 条问题的**正确修法不是"改用 Radix"**——Radix 不提供"把任意容器变成按钮"的原语。
正确修法是**换回真元素**（`<button>` / `<a>`）：焦点、`Enter`/`Space` 的角色差异、
`:focus-visible`、`disabled` 语义全部由浏览器给出，**一行键盘逻辑都不需要写**。

**规则**（`role="button"` 的准入条件）：

| # | 条件 | 缺一即缺陷 |
| --- | --- | --- |
| 1 | 无法改成真元素（有具体理由，写在注释里） | |
| 2 | 有 `tabIndex={0}`（或 `-1` + roving tabindex 方案） | |
| 3 | 有 `Enter` **和** `Space` 两个处理（`Space` 必须 `preventDefault()` 防滚动） | |
| 4 | 有可见的 `:focus-visible` 指示 | |
| 5 | 有 `aria-disabled` 或真的 `disabled` 语义 | |

**优先顺序**：真元素 → Radix 原语 → 三件套齐全的 `role="button"`。**不要跳过第一步。**

### 4.5 2.5.7 Dragging Movements（2.2 新增，AA）

实测的拖拽交互：

| 位置 | 拖拽内容 | 非拖拽替代 |
| --- | --- | --- |
| `pages/logical-models/components/logical-model-card.tsx:124`（`touch-none`） | 拖拽排序 | **待补** |
| `pages/model-management/components/provider-grid.tsx:88`（`touch-none`） | 拖拽排序 | **待补** |
| `pages/router` 画布节点 | 拖动位置 | ✅ React Flow 提供键盘移动（但其可达性未核） |
| `components/ui/resizable.tsx` | 面板尺寸 | `[未核实]` 是否只支持拖拽 |

**规则**：任何拖拽排序必须同时提供**上下移动按钮**或**键盘操作**（如 `Alt+↑/↓`）。
`touch-none` 只是禁掉了触摸滚动，**不等于**满足 2.5.7。

---

## 5. 动效降级

### 5.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **2.3.3 Animation from Interactions** | AAA | 交互触发的动效可以被禁用（本文作目标） |
| **2.2.2 Pause, Stop, Hide** | A | 自动播放且超过 5 秒的动效必须可暂停/停止/隐藏 |

`prefers-reduced-motion` 是**在 [`design-system.md`](./design-system.md) 里被列为红线**的一项
（"键盘/焦点/动效降级一律来自 Radix"），但**降级本身要有人写**——Radix 只保证它自己的
动画（`data-state` 驱动的入场/出场）会降级，我们自己加的动画不会。

### 5.2 现状（实测）

| 通道 | 处数 | 位置 |
| --- | --- | --- |
| CSS `@media (prefers-reduced-motion: reduce)` | **1** | `styles/index.css:742-748`（只覆盖 `.status-event-pulse`） |
| Tailwind `motion-reduce:` | **11** | `interactive-hover-button.tsx:26,27,31`；`app-sidebar.tsx:43,145,168,180,192,308`；`window-titlebar.tsx:34`；`layout.tsx:53` |
| JS `matchMedia('(prefers-reduced-motion: reduce)')` | **0** | **不存在** |

**`styles/index.css:742-748` 的写法是范例**：

```css
@media (prefers-reduced-motion: reduce) {
  .status-event-pulse {
    animation: none;
    opacity: 0.45;      /* 保留「有事件」这一信息，用静态样式替代动画 */
    transform: none;
  }
}
```

**要点**：降级**不是删掉效果**，而是**换成静态等价物**（这里用 `opacity: 0.45` 表达
"刚发生过一次事件"）。

### 5.3 规则

| # | 规则 |
| --- | --- |
| 1 | **两条通道都要用**：Tailwind 写的类用 `motion-reduce:`；`index.css` 里的动画用 `@media`。二选一即可，**但每个动画至少命中一条** |
| 2 | **降级要保留信息**，不是直接 `animation: none` 了事。问一句"关掉动画后，用户还知道发生了什么吗" |
| 3 | **JS 驱动的动画**（`motion/react`）必须用 `useReducedMotion()` 之类的钩子判断——**当前 0 处**，是缺口 |
| 4 | `motion-safe:` 用于"只有允许动效时才加"的场景（与 `motion-reduce:` 反向） |

### 5.4 缺口

| 缺口 | 说明 |
| --- | --- |
| **`motion/react` 的使用未降级** | 仓库依赖 `motion ^14.2.0`（`packages/console/package.json`），`AnimatePresence` / `motion.*` 在多处使用（如 `receipt-printer-preview/machine.tsx:1`），但**没有一处**判断 reduced motion。这是**当前最大的动效降级缺口** |
| **`animate-pulse` / `animate-spin`** | `skeleton.tsx`（`animate-pulse`）、`spinner.tsx`（`animate-spin`）是**持续动画**，属 2.2.2 的管辖范围。骨架屏的脉冲通常被认为可接受，但**应在 `motion-reduce:` 下停掉**：`motion-reduce:animate-none` |

---

## 6. IME 组合态

### 6.1 现状：**完全不存在**（实测）

`compositionstart` / `compositionend` / `isComposing` / `CompositionEvent` /
`onCompositionStart` 在 `packages/console/source` 里 **0 处**。

[`design-system.md`](./design-system.md) 把它列为红线（"IME 组合态 … 不许手写"），
处置是**依赖 Radix**。**这个处置是对的**：`Enter` 提交这类逻辑如果由 Radix 或
原生 `<input>` 承担，IME 组合态由浏览器保证。

### 6.2 规则

| # | 规则 |
| --- | --- |
| 1 | **凡是"输入框里按 Enter 就提交/选中"的逻辑，必须先判组合态**。判据：`event.nativeEvent.isComposing === true` 或 `event.keyCode === 229` 时**不处理** |
| 2 | **优先避免手写**：能用原生表单提交（`<form onSubmit>`）就不用 `onKeyDown` |
| 3 | 中文用户是主要用户群（`apps/docs/README.md`：中文是主要维护语言），所以**这条不是可选项** |

### 6.3 已知风险点（§4.3 里"合理"的两条其实有 IME 风险）

| 位置 | 风险 |
| --- | --- |
| `settings-number-row.tsx:60-62` | 数字输入框，IME 风险低（数字不触发组合），但**仍应判** `isComposing` |
| `request-contents-toolbar.tsx:42-46` | **搜索框按 Enter 跳匹配**——中文搜索时按 Enter 确认候选词会**误触发跳转**。这是**当前最实际的 IME 缺陷** |
| `field-path-input.tsx:81-89` / `landing-editor.tsx:152-168` | 手写 combobox 的 `Enter` 选中，同样有中文输入误触问题 |

**检查方法**：在中文输入法下，于这些输入框里输入拼音，按 `Enter` 确认候选词，
观察是否误触发提交/跳转/选中。

---

## 7. RTL（从右到左）

### 7.1 现状（实测）

| 项 | 结果 |
| --- | --- |
| `components/ui/direction.tsx` | 存在（23 行，包装 Radix `Direction.DirectionProvider` + 导出 `useDirection`） |
| **它是否被使用** | **0 处 import**——**死代码** |
| `dir="rtl"` / `dir="ltr"` 字面量 | **0 处** |
| `--direction` CSS 变量 | **0 处** |
| **逻辑属性** | `ms-auto`×1（`questionnaire.tsx:138`）、`inset-s-1/2`×1（`message-scroller.tsx:100`）、`after:start-1/2`×1（`sidebar.tsx:289`）、`text-start`×1（`questionnaire.tsx:109`） |
| **物理属性** | `pl-`×63、`pr-`×51、`ml-`×41、`mr-`×16、`text-end`×0 |
| `rtl:` 变体 | ×4（`message-scroller.tsx:100`、`calendar.tsx:35,36`）；`ltr:` ×1 |

**结论**：osw 目前是**物理方向（LTR-only）**的实现，逻辑属性采用率约 **4 / 175**。

### 7.2 规则

**当前不承诺 RTL 支持**（语言只有 `zh` / `en` 两种，见 [`i18n.md`](../data/i18n.md)）。
因此本节的规则是**"不要让未来的 RTL 更贵"**，不是"现在就支持 RTL"：

| # | 规则 | 理由 |
| --- | --- | --- |
| 1 | **新代码优先用逻辑属性**（`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`/`text-start`） | 它们与物理属性在 LTR 下**渲染完全相同**，零成本 |
| 2 | **不要引入只在 RTL 下才对的写法** | 现在没有 RTL 分支，任何 `rtl:` 变体都是不可测的死代码（现有的 4 处 `rtl:` 属此类） |
| 3 | **`direction.tsx` 的处置待定** | 它是死代码。**要么删、要么在 `layout` 里挂上并承诺 RTL**——不要留着当装饰 |
| 4 | **图标方向敏感** | 箭头类图标（`ArrowRight` / `ChevronRight`）在 RTL 下要镜像。`block-icon.tsx` 用 `ArrowRight` 表示 `output` 节点，属方向敏感 |

---

## 8. 屏幕阅读器播报

### 8.1 判据（`[文档]`）

| 准则 | 等级 | 要求 |
| --- | --- | --- |
| **1.3.1 Info and Relationships** | A | 结构与关系要在代码里可表达 |
| **4.1.2 Name, Role, Value** | A | 每个控件有可访问名称与角色 |
| **4.1.3 Status Messages** | AA | 状态消息要能被辅助技术感知，且不夺焦点 |
| **3.3.1 Error Identification** | A | 错误要被识别并**用文字描述** |
| **1.3.5 Identify Input Purpose** | AA | 输入用途可被程序判定 |

### 8.2 现状（实测频次）

| 属性 | 处数 | 说明 |
| --- | --- | --- |
| `aria-label` | **168** | 主用；~60 个文件 |
| **`aria-labelledby`** | **0** | ⚠️ **完全缺失** |
| **`aria-describedby`** | **0** | ⚠️ **完全缺失** |
| `aria-live` | **3** | 全是 `polite`（`machine.tsx:51`、`tray/page.tsx:96`、`request-contents-toolbar.tsx:53`） |
| `aria-expanded` | 26 | 含 `button.tsx` 的 `aria-expanded:` 变体 |
| `aria-controls` | 2 | 只在两个手写 combobox 里 |
| `aria-invalid` | 63 | 16 个原语 + 4 个调用点 |
| `aria-pressed` | 4 | |
| `aria-current` | 3 | |
| `role=` | 55 | 18 种取值 |
| `sr-only` | 17（14 个文件） | |
| `VisuallyHidden` 组件 | **不存在** | 直接用 `className="sr-only"` |

### 8.3 两个结构性缺口

**缺口一：`aria-labelledby` / `aria-describedby` 全仓 0 处。**
这意味着**所有"关联"都是靠 `aria-label` 硬写字符串**。后果：

- 表单的**错误文字与输入框没有程序化关联**——`FormField` 传 `htmlFor` 给 `<label>`，
  但 `error` 文字是**独立的一个 `<p>`**，没有 `aria-describedby` 指向它。
  屏幕阅读器读到输入框时**不会播报错误**。
- 这是 3.3.1 的直接缺口：错误"可见但不可被辅助技术识别"。

**缺口二：`role="alert"` 只有 2 处**，`aria-live` 只有 3 处。
toast / 保存成功 / 复制成功这类反馈的播报路径不统一。

> 注：`components/ui/field.tsx:176`（`FieldError`）实现了 `role="alert"`，
> 但 **`field.tsx` 是死代码（0 引用）**，所以它没有生效。

### 8.4 规则

| # | 规则 |
| --- | --- |
| 1 | **表单错误必须 `aria-describedby` 关联**：`<Input aria-invalid aria-describedby={errorId} />` + `<p id={errorId}>`。这是 3.3.1 的最低要求 |
| 2 | **状态播报用 `aria-live="polite"`**，不用 `alert`（`alert` 会打断用户）；只有**必须立刻知道**的（会话失效）才用 `role="alert"` |
| 3 | **纯图标按钮必须有 `aria-label`**，且文案来自 i18n 目录（`sr-only` + 文本也可，但要注意 `field.tsx:59,63` 的 `[&>.sr-only]:w-auto` 那类选择器） |
| 4 | **装饰性图标 `aria-hidden="true"`**。**`lucide-react` 会自动加**：无 `aria-*` / `role` / `title` 时它自己补 `aria-hidden="true"`（`[源码]`，`lucide-react@1.59.0` 的 `dist/esm/shared/src/build/buildLucideIconNode.mjs:47-49`：`...params.hasA11yProp === false ? { 'aria-hidden': "true" } : {}`）。所以**不要**再手写（版本口径见 [`design-system-icons.md`](./design-system-icons.md) §8） |
| 5 | **数据表格用真 `<table>` 语义**，不用 `role="grid"` 手工搭 |
| 6 | **不要用 `sr-only` 组件化**：仓库用 `className="sr-only"` 是既定做法，引入 `VisuallyHidden` 会造成两套写法 |

---

## 9. 可执行基线（汇总清单）

评审时逐条过。**每条都能判"过/不过"，不需要再讨论定义。**

### 9.1 对比度

- [ ] 正文文字对**实际背景** ≥ **4.5:1**（`1.4.3` AA）
- [ ] 控件边界与状态 ≥ **3:1**（`1.4.11` AA）
- [ ] **明暗两套分别**验过（见 [`design-system-theming.md`](./design-system-theming.md)）
- [ ] 没有用 alpha 叠色表达禁用态

### 9.2 目标尺寸

- [ ] 所有可点元素 ≥ **24×24px**（`2.5.8` AA，**无例外**）
- [ ] 主操作 ≥ **44×44px** 命中区（`2.5.5` AAA / Primer `coarse`）
- [ ] 视觉小于下限时用透明命中区扩展，不是放大视觉

### 9.3 焦点

- [ ] 每个可聚焦元素有 `focus-visible:` 指示，**不依赖全局 `outline` 兜底**
- [ ] 焦点环宽度统一 **2px**（`ring-2`，不用 `ring-3` / `ring-[3px]` / `ring-1`）
- [ ] 焦点环颜色走语义 token（`state-accent-solid` / `destructive`），不用 `/20` `/40` `/50`
- [ ] `sticky` / `fixed` 覆盖层没有把聚焦元素**完全**遮住（`2.4.11` AA）

### 9.4 键盘

- [ ] 没有新写的焦点陷阱 / `Esc` 逐层 / 方向键 / `Home`·`End` / `Tab` 逻辑
- [ ] `role="button"` 满足 §4.4 的五件套；否则改成真元素
- [ ] 所有拖拽排序有非拖拽替代（`2.5.7` AA）
- [ ] `Tab` 顺序与视觉顺序一致（`2.4.3` A）

### 9.5 动效

- [ ] 每个动画命中 `motion-reduce:` 或 `@media (prefers-reduced-motion)` 之一
- [ ] 降级后**信息仍在**（不是 `animation: none` 了事）
- [ ] `motion/react` 驱动的动画判了 reduced motion（**当前全缺**）
- [ ] 持续的 `animate-pulse` / `animate-spin` 在 `motion-reduce:` 下停掉

### 9.6 IME

- [ ] 输入框里的 `Enter` 逻辑判了 `isComposing`
- [ ] 中文输入法下实测过：输入拼音 → `Enter` 确认候选 → **不误触发**

### 9.7 播报

- [ ] 纯图标按钮有 `aria-label`，文案来自 i18n 目录
- [ ] 表单错误用 `aria-describedby` **关联**到控件（不只是显示出来）
- [ ] 状态消息用 `aria-live="polite"`；`role="alert"` 只用于必须打断的场景
- [ ] 装饰图标不手写 `aria-hidden`（lucide 自动加）

### 9.8 检查方法

```bash
cd packages/console/source
# 焦点环宽度是否混用
rg -o --no-filename 'focus-visible:ring-(\[3px\]|[0-9])' --glob '*.tsx' . | sort | uniq -c
# 焦点环颜色是否混用
rg -o --no-filename 'focus-visible:ring-[a-z-]+(/[0-9]+)?' --glob '*.tsx' . | sort | uniq -c
# 动效降级覆盖
rg -c 'motion-reduce:|prefers-reduced-motion' --glob '*.tsx' --glob '*.css' .
# 目标尺寸
rg -o --no-filename '\b(size|min-h|h)-11\b' --glob '*.tsx' . | sort | uniq -c
# 播报关联缺口
rg -c 'aria-labelledby|aria-describedby' --glob '*.tsx' .        # 当前 0
# 手写键盘逻辑
rg -n 'onKeyDown|addEventListener\(.keydown' --glob '*.tsx' --glob '*.ts' . | grep -v components/ui/
```

**人工检查（无法脚本化）**：

1. **`2.4.11`**：把窗口缩到最小，用 `Tab` 走一遍每个页面，检查聚焦元素是否被 sticky 表头/吸底栏遮住。
2. **`6.2` IME**：切到中文输入法，在每个搜索/命名输入框里输入拼音并按 `Enter` 确认候选词。
3. **`2.5.7`**：把鼠标拔掉思路——只用键盘能不能完成拖拽排序要做的同一件事。

---

## 10. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **中文语境下"大号文字"的阈值** | `[未核实]` | WCAG 2.2 术语表 `large scale (text)` 给出 CJK 的**等价条款但没有数值**（原文："font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts"）。**没有可直接引用的数字**，本文因此不按大号文字给豁免（osw 字号 ≤16px，本来也用不上） |
| **`input.tsx` 缺少自身 `focus-visible:` 环是有意还是遗漏** | `[未核实]` | `input.tsx:15` 的根类没有 focus 环，依赖 `index.css:683-689` 的全局规则。两种解释都自洽（"统一由全局管"／"漏了"），代码与注释都没说明 |
| **`2.4.11` 在 sticky 表头下的实际表现** | `[未核实]` | 需要真机滚动 + 键盘导航实测。本文只登记风险，**未判定为缺陷** |
| **React Flow 画布节点的键盘可达性** | `[未核实]` | 已知 `use-workflow-studio.ts:354-361` 有全局 `Delete` 处理，但**节点能否用键盘遍历/选中/移动**未核实。这直接关系到 2.1.1 与 2.5.7 |
| **每个浮层的 `Esc`/焦点陷阱是否真的来自 Radix 原语** | `[未核实]` | 本文确认了"没有手写 `Esc`/方向键"，但 `components/ui/*` 本身是 shadcn 风格的二次封装，**没有逐个核对**它对 Radix 的透传是否有遗漏。这是最值得接着做的一项 |
| **`components/ui/resizable.tsx` 是否只支持拖拽** | `[未核实]` | 未读该组件实现，无法判定 2.5.7 是否适用 |
| **`bill-export-scene.tsx` 导出图的对比度** | 不适用 | 导出产物是一张 PNG 图片，属"图片内容"，不适用 1.4.3 的文字对比度条款（但其中的账单文字是真实文字，**若账单本身要满足对比度，需单独核**）→ 这条边界本身也 `[未核实]` |
