# osw 设计系统（从实现抽取）

> 这份文档不是“重新设计”，也不是上游规范的转述。它只回答一件事：**当前代码里真实生效的设计系统长什么样**。
>
> 生成方式：`node scripts/design-system/extract-tokens.mjs`。所有色值、对比度、行号、计数都来自
> `packages/console/source/styles/index.css` 与 `packages/console/source/**` 的源码；手写部分只负责解释与判断。
> 预览页：`docs/design-system/index.html`（双击打开即可，无外部依赖）。

标签约定：`[源码]` = 从仓库文件读出的原文；`[生成]` = 抽取脚本计算出的值；`[未核实]` = 没有证据，不作为结论。

---

## 1. 源可信度：读了什么、怎么验证

### 1.1 权威源（按优先级）

| # | 文件 | 作用 | 证据 |
| --- | --- | --- | --- |
| 1 | `packages/console/source/styles/index.css` | 唯一的 token 声明处：`@theme inline`（shadcn 别名）、`@theme`（业务 token）、`:root` / `.dark`（原始通道）、`system-*` 排版 utility | 全文 `[源码]` |
| 2 | `packages/console/source/components/ui/*.tsx` | 40 个组件的实际类名：尺寸、状态、圆角、阴影都从这里取值 | 逐文件核对 `[源码]` |
| 3 | `packages/console/vite.config.ts` | Tailwind v4 通过 `@tailwindcss/vite` 接入；没有 `tailwind.config.*` | `[源码]` |
| 4 | `package.json` | 字体只安装了 `@fontsource-variable/geist` | `[源码]` |
| 5 | `apps/docs/specs/design/*.md` | **对照对象，不是权威**：用于发现“文档声称”与“代码实际”的漂移 | 见 §11 DS-024 |

### 1.2 怎么验证

```bash
node scripts/design-system/extract-tokens.mjs            # 重新生成 token JSON / 本文的生成块 / 预览页
node scripts/design-system/extract-tokens.mjs --check    # 只校验、不落盘（CI / 守卫用的就是它）
```

守卫测试是 `packages/console/source/design-system.guard.test.ts`，跟全仓测试一起跑：

```bash
node packages/toolkit/scripts/test.mjs packages/console/source/design-system.guard.test.ts
```

它做五件事，对应五类“文档开始撒谎”的失效：

1. **生成物与源码一致**：以 `--check` 重算三份产物，要求 `tokens.generated.json`、本文的生成块、`index.html` 三者与重新生成的结果逐字节相同；
2. **预览页自包含**：`index.html` 里不能出现 `http(s)://`、外链 `<script src>`、`<link rel="stylesheet">` 或 `@import`，保证 `file://` 双击可读；
3. **引用闭合**：页面与本文里出现的每个 `var(--x)` 都要能找到声明（页面就地声明的 `--ds-*` 也算），只有文中作为示例的 `var(--token)` 例外；
4. **对比度可重算**：每个实测对都能按 WCAG 相对亮度从当前色值算出同一个数（±0.02），且 `pass` 结论与阈值一致；
5. **证据仍在**：问题清单每条引用的 `文件:行` 都存在且不是空行，P0–P3 的条数与 `meta.issues` 一致。

第 1 条是主守卫：改了 `index.css` 或组件类名却忘了重跑生成器，测试会直接红，而不是让文档悄悄过期。

### 1.3 本次抽取的规模 `[生成]`

<!-- GENERATED:stats:start -->
| 项 | 数量 |
| --- | --- |
| CSS 自定义属性声明（含排版/圆角/阴影） | 405 |
| 颜色 token（`--color-*`，含 shadcn 别名层） | 144 |
| 原始通道 token（`:root` / `.dark`） | 40 |
| 排版 utility（`system-*`） | 23 |
| 对比度实测对 | 42 |
| 源码中的字面颜色出现点（含注释/插图） | 44 |
| 问题 | 5 P0 / 12 P1 / 10 P2 / 2 P3 |
| 未核实项 / 待拍板项 | 6 / 9 |
| 样式源 SHA-256（前 16 位） | `39037aeb1ee61b2d` |
<!-- GENERATED:stats:end -->

> 口径说明：颜色 token 数包含 `@theme inline` 里的 shadcn 别名（`background`、`card`、`primary`…）与 `@theme` 里的业务 token；
> “字面颜色出现点”包含注释、插图与品牌 logo，不能直接当成缺陷数。

---

## 2. 颜色

### 2.1 判据

| 用途 | 阈值 | 依据 |
| --- | --- | --- |
| 正文/小字（< 24px，或 < 18.66px 粗体） | **4.5:1** | WCAG 2.2 SC 1.4.3 |
| 大字号（≥ 24px，或 ≥ 18.66px 粗体） | 3:1 | 同上 |
| 控件边界、焦点指示、非文字状态 | **3:1** | WCAG 2.2 SC 1.4.11 |
| 禁用态 | 不要求 | SC 1.4.3 明确豁免 |
| 纯装饰（分隔线、插图、品牌） | 不要求 | 需在实现里登记为例外 |

对比度按 sRGB 相对亮度计算；半透明前景先与背景合成，半透明背景先与承载层（卡片/页面底）合成。
每行的“量对底色”就是实际参与计算的那个颜色。

### 2.2 原始通道 token（`:root` / `.dark`）

这些是 HSL 三段值（`H S% L%`），由 `@theme inline` 的 `hsl(var(--x))` 消费。**不要直接在组件里用它们**。

<!-- GENERATED:primitives:start -->
| Token | 亮色（原始值） | 暗色（原始值） | index.css 行 |
| --- | --- | --- | --- |
| `--accent` | `0 0% 9% / 0.08` | `0 0% 98% / 0.12` | 579 |
| `--accent-foreground` | `0 0% 9%` | `0 0% 98%` | 580 |
| `--background` | `0 0% 98%` | `0 0% 7%` | 563 |
| `--border` | `0 0% 90%` | `0 0% 20%` | 583 |
| `--canvas` | `0 0% 97%` | `0 0% 8%` | 570 |
| `--card` | `0 0% 100%` | `0 0% 12%` | 565 |
| `--card-foreground` | `0 0% 9%` | `0 0% 98%` | 566 |
| `--chart-1` | `12 76% 61%` | `220 70% 50%` | 586 |
| `--chart-2` | `173 58% 39%` | `160 60% 45%` | 587 |
| `--chart-3` | `197 37% 24%` | `30 80% 55%` | 588 |
| `--chart-4` | `43 74% 66%` | `280 65% 60%` | 589 |
| `--chart-5` | `27 87% 67%` | `340 75% 55%` | 590 |
| `--destructive` | `6 65% 48%` | `6 65% 42%` | 581 |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 98%` | 582 |
| `--foreground` | `0 0% 9%` | `0 0% 98%` | 564 |
| `--info` | `210 70% 45%` | `207 90% 60%` | 596 |
| `--info-foreground` | `0 0% 100%` | `0 0% 100%` | 597 |
| `--input` | `0 0% 90%` | `0 0% 16%` | 584 |
| `--inset` | `0 0% 92%` | `0 0% 5%` | 607 |
| `--muted` | `0 0% 96%` | `0 0% 15%` | 577 |
| `--muted-foreground` | `0 0% 40%` | `0 0% 66%` | 578 |
| `--popover` | `0 0% 100%` | `0 0% 19%` | 571 |
| `--popover-foreground` | `0 0% 9%` | `0 0% 98%` | 572 |
| `--primary` | `0 0% 9%` | `0 0% 98%` | 573 |
| `--primary-foreground` | `0 0% 100%` | `0 0% 9%` | 574 |
| `--ring` | `0 0% 9%` | `0 0% 98%` | 585 |
| `--secondary` | `0 0% 96%` | `0 0% 15%` | 575 |
| `--secondary-foreground` | `0 0% 15%` | `0 0% 98%` | 576 |
| `--sidebar-accent` | `0 0% 9% / 0.08` | `0 0% 98% / 0.12` | 613 |
| `--sidebar-accent-foreground` | `0 0% 9%` | `0 0% 98%` | 614 |
| `--sidebar-background` | `0 0% 96%` | `0 0% 5%` | 609 |
| `--sidebar-border` | `0 0% 90%` | `0 0% 15%` | 615 |
| `--sidebar-foreground` | `0 0% 28%` | `0 0% 82%` | 610 |
| `--sidebar-primary` | `0 0% 9%` | `0 0% 98%` | 611 |
| `--sidebar-primary-foreground` | `0 0% 100%` | `0 0% 9%` | 612 |
| `--sidebar-ring` | `0 0% 9%` | `0 0% 98%` | 616 |
| `--success` | `153 61% 38%` | `145 65% 42%` | 592 |
| `--success-foreground` | `0 0% 100%` | `160 30% 7%` | 593 |
| `--warning` | `39 92% 45%` | `39 92% 50%` | 594 |
| `--warning-foreground` | `30 20% 8%` | `30 20% 8%` | 595 |
<!-- GENERATED:primitives:end -->

### 2.3 语义色板

`✅` = 达到该行阈值；`❌` = 低于阈值；`—` = 装饰性/禁用态或没有可配对的背景。
“其上文本”表示该 token 是背景，比值来自压在它上面的文本。

<!-- GENERATED:colors:start -->
#### 基础语义（shadcn 别名层）（27）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `accent` | #171717 · 8% | #fafafa · 12% | — / — | — / — | — | 93 |
| `accent-foreground` | #171717 | #fafafa | — / — | — / — | — | 94 |
| `background` | #fafafa | #121212 | 17.18:1 ✅ / 17.95:1 ✅ | #171717 / #fafafa（其上文本） | 4.5:1 | 75 |
| `background-body` | #f2f4f7 | #1d1d20 | 16.11:1 ✅ / 16.26:1 ✅ | #101828 / #fbfbfc（其上文本） | 4.5:1 | 184 |
| `background-default` | #ffffff | #222225 | — / — | — / — | — | 185 |
| `background-default-dimmed` | #e9ebf0 | #27272b | — / — | — / — | — | 188 |
| `background-default-dodge` | #ffffff | #3a3a40 | — / — | — / — | — | 189 |
| `background-default-hover` | #f9fafb | #27272b | — / — | — / — | — | 186 |
| `background-default-subtle` | #fcfcfd | #222225 | — / — | — / — | — | 187 |
| `border` | #e6e6e6 | #333333 | — / — | — / — | — | 97 |
| `canvas` | #f7f7f7 | #141414 | 16.57:1 ✅ / 17.81:1 ✅ | #101828 / #fbfbfc（其上文本） | 4.5:1 | 84 |
| `card` | #ffffff | #1f1f1f | 17.75:1 ✅ / 15.94:1 ✅ | #101828 / #fbfbfc（其上文本） | 4.5:1 | 77 |
| `card-foreground` | #171717 | #fafafa | 17.93:1 ✅ / 15.79:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 78 |
| `destructive` | #ca3b2b | #b13325 | — / — | — / — | — | 95 |
| `destructive-foreground` | #ffffff | #fafafa | — / — | — / — | — | 96 |
| `foreground` | #171717 | #fafafa | 17.18:1 ✅ / 17.95:1 ✅ | #fafafa / #121212 | 4.5:1 | 76 |
| `input` | #e6e6e6 | #292929 | — / — | — / — | — | 98 |
| `inset` | #ebebeb | #0d0d0d | 14.89:1 ✅ / 18.79:1 ✅ | #101828 / #fbfbfc（其上文本） | 4.5:1 | 112 |
| `muted` | #f5f5f5 | #262626 | 5.27:1 ✅ / 6.36:1 ✅ | #666666 / #a8a8a8（其上文本） | 4.5:1 | 91 |
| `muted-foreground` | #666666 | #a8a8a8 | 5.27:1 ✅ / 6.36:1 ✅ | #f5f5f5 / #262626 | 4.5:1 | 92 |
| `popover` | #ffffff | #303030 | 17.93:1 ✅ / 12.64:1 ✅ | #171717 / #fafafa（其上文本） | 4.5:1 | 85 |
| `popover-foreground` | #171717 | #fafafa | 17.93:1 ✅ / 12.64:1 ✅ | #ffffff / #303030 | 4.5:1 | 86 |
| `primary` | #171717 | #fafafa | 17.93:1 ✅ / 17.18:1 ✅ | #ffffff / #171717（其上文本） | 4.5:1 | 87 |
| `primary-foreground` | #ffffff | #171717 | 17.93:1 ✅ / 17.18:1 ✅ | #171717 / #fafafa | 4.5:1 | 88 |
| `ring` | #171717 | #fafafa | 17.93:1 ✅ / 15.79:1 ✅ | #ffffff / #1f1f1f | 3:1 | 99 |
| `secondary` | #f5f5f5 | #262626 | — / — | — / — | — | 89 |
| `secondary-foreground` | #262626 | #fafafa | — / — | — / — | — | 90 |

#### 文本层级（13）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `text-accent` | #171717 | #fafafa | 17.93:1 ✅ / 15.79:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 173 |
| `text-accent-secondary` | #171717 · 80% | #fafafa · 80% | — / — | — / — | — | 174 |
| `text-destructive` | #d92d20 | #f97066 | 4.83:1 ✅ / 5.92:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 175 |
| `text-disabled` | #d0d5dc | #c8ceda · 30% | 1.48:1 — / 2.17:1 — | #ffffff / #1f1f1f | — | 180 |
| `text-inverted` | #000000 | #ffffff | — / — | — / — | — | 181 |
| `text-primary` | #101828 | #fbfbfc | 17.75:1 ✅ / 15.94:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 162 |
| `text-quaternary` | #101828 · 50% | #c8ceda · 50% | 3.37:1 ❌ / 3.67:1 ❌ | #ffffff / #1f1f1f | 4.5:1 | 168 |
| `text-secondary` | #354052 | #d9d9de | 10.47:1 ✅ / 11.72:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 163 |
| `text-success` | #079455 | #17b26a | 3.91:1 ❌ / 5.98:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 176 |
| `text-success-secondary` | #17b26a | #47cd89 | — / — | — / — | — | 177 |
| `text-tertiary` | #676f83 | #c8ceda · 60% | 5.03:1 ✅ / 4.63:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 164 |
| `text-warning` | #dc6803 | #f79009 | 3.49:1 ❌ / 7.02:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 178 |
| `text-warning-secondary` | #f79009 | #fdb022 | — / — | — / — | — | 179 |

#### 状态色（success / warning / info）（6）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `info` | #2273c3 | #3da2f5 | 4.27:1 ❌ / 5.2:1 ✅ | #e9f1f9 / #222c34 | 4.5:1 | 110 |
| `info-foreground` | #ffffff | #ffffff | — / — | — / — | — | 111 |
| `success` | #269c67 | #25b15f | — / — | — / — | — | 106 |
| `success-foreground` | #ffffff | #0c1714 | — / — | — / — | — | 107 |
| `warning` | #dc9209 | #f5a30a | — / — | — / — | — | 108 |
| `warning-foreground` | #181410 | #181410 | — / — | — / — | — | 109 |

#### 交互态（13）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `state-accent-active` | #171717 · 8% | #fafafa · 8% | — / — | — / — | — | 199 |
| `state-accent-hover` | #171717 · 8% | #fafafa · 8% | — / — | — / — | — | 198 |
| `state-accent-solid` | #171717 | #fafafa | — / — | — / — | — | 197 |
| `state-base-active` | #c8ceda · 40% | #c8ceda · 20% | — / — | — / — | — | 194 |
| `state-base-handle` | #101828 · 20% | #c8ceda · 30% | — / — | — / — | — | 195 |
| `state-base-handle-hover` | #101828 · 30% | #c8ceda · 50% | — / — | — / — | — | 196 |
| `state-base-hover` | #c8ceda · 20% | #c8ceda · 8% | — / — | — / — | — | 192 |
| `state-base-hover-alt` | #c8ceda · 40% | #c8ceda · 14% | — / — | — / — | — | 193 |
| `state-destructive-hover` | #fef3f2 | #f04438 · 14% | — / — | — / — | — | 203 |
| `state-destructive-solid` | #f04438 | #f97066 | — / — | — / — | — | 202 |
| `state-success-solid` | #17b26a | #47cd89 | — / — | — / — | — | 200 |
| `state-warning-hover` | #fffaeb | #f79009 · 14% | — / — | — / — | — | 204 |
| `state-warning-solid` | #f79009 | #f79009 | — / — | — / — | — | 201 |

#### 组件级（38）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `components-actionbar-bg` | #ffffff · 95% | #222225 | — / — | — / — | — | 240 |
| `components-actionbar-border` | #101828 · 4% | #c8ceda · 8% | — / — | — / — | — | 241 |
| `components-button-destructive-ghost-bg-hover` | #fee4e2 | #f04438 · 14% | — / — | — / — | — | 281 |
| `components-button-destructive-ghost-text` | #d92d20 | #f97066 | 4.83:1 ✅ / 5.92:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 280 |
| `components-button-ghost-bg-hover` | #c8ceda · 20% | #c8ceda · 8% | — / — | — / — | — | 279 |
| `components-button-ghost-text` | #354052 | #d9d9de | 10.47:1 ✅ / 11.72:1 ✅ | #ffffff / #1f1f1f | 4.5:1 | 278 |
| `components-button-primary-bg` | #171717 | #fafafa | 17.93:1 ✅ / 17.18:1 ✅ | #ffffff / #171717（其上文本） | 4.5:1 | 265 |
| `components-button-primary-bg-hover` | #171717 · 90% | #fafafa · 90% | — / — | — / — | — | 266 |
| `components-button-primary-border` | #ffffff · 12% | #171717 · 12% | — / — | — / — | — | 268 |
| `components-button-primary-text` | #ffffff | #171717 | 17.93:1 ✅ / 17.18:1 ✅ | #171717 / #fafafa | 4.5:1 | 267 |
| `components-button-secondary-accent-text` | #171717 | #ffffff · 80% | — / — | — / — | — | 272 |
| `components-button-secondary-bg` | #ffffff | #ffffff · 12% | — / — | — / — | — | 269 |
| `components-button-secondary-bg-hover` | #f9fafb | #ffffff · 20% | — / — | — / — | — | 270 |
| `components-button-secondary-border` | #101828 · 14% | #ffffff · 8% | — / — | — / — | — | 273 |
| `components-button-secondary-border-hover` | #101828 · 20% | #ffffff · 12% | — / — | — / — | — | 274 |
| `components-button-secondary-text` | #354052 | #ffffff · 80% | 10.47:1 ✅ / 7.98:1 ✅ | #ffffff / #3a3a3a | 4.5:1 | 271 |
| `components-button-tertiary-bg` | #f2f4f7 | #ffffff · 8% | — / — | — / — | — | 275 |
| `components-button-tertiary-bg-hover` | #e9ebf0 | #ffffff · 12% | — / — | — / — | — | 276 |
| `components-button-tertiary-text` | #354052 | #d9d9de | 9.5:1 ✅ / 9.25:1 ✅ | #f2f4f7 / #313131 | 4.5:1 | 277 |
| `components-input-bg-active` | #f9fafb | #ffffff · 16% | — / — | — / — | — | 258 |
| `components-input-bg-disabled` | #c8ceda · 14% | #ffffff · 3% | — / — | — / — | — | 259 |
| `components-input-bg-hover` | #c8ceda · 25% | #ffffff · 8% | — / — | — / — | — | 257 |
| `components-input-bg-normal` | #c8ceda · 40% | #ffffff · 12% | — / — | — / — | — | 256 |
| `components-input-border-active` | #d0d5dc | #747481 | — / — | — / — | — | 264 |
| `components-input-border-hover` | #d0d5dc | #3a3a40 | 1.33:1 ❌ / 1.15:1 ❌ | #f1f3f6 / #313131 | 3:1 | 263 |
| `components-input-text-filled` | #101828 | #f4f4f5 | 14.88:1 ✅ / 10.35:1 ✅ | #e9ebf0 / #3a3a3a | 4.5:1 | 260 |
| `components-input-text-filled-disabled` | #676f83 | #c8ceda · 60% | 4.73:1 — / 4.42:1 — | #f7f8fa / #262626 | — | 261 |
| `components-input-text-placeholder` | #98a2b2 | #c8ceda · 30% | 2.16:1 ❌ / 1.98:1 ❌ | #e9ebf0 / #3a3a3a | 4.5:1 | 262 |
| `components-option-card-option-bg` | #fcfcfd | #c8ceda · 4% | — / — | — / — | — | 234 |
| `components-option-card-option-bg-hover` | #ffffff | #c8ceda · 14% | — / — | — / — | — | 236 |
| `components-option-card-option-border` | #e9ebf0 | #c8ceda · 20% | — / — | — / — | — | 235 |
| `components-option-card-option-border-hover` | #d0d5dc | #c8ceda · 30% | — / — | — / — | — | 237 |
| `components-option-card-option-selected-bg` | #ffffff | #ffffff · 5% | — / — | — / — | — | 238 |
| `components-option-card-option-selected-border` | #171717 | #fafafa | — / — | — / — | — | 239 |
| `components-panel-bg` | #ffffff | #222225 | — / — | — / — | — | 242 |
| `components-panel-bg-blur` | #ffffff · 95% | #2c2c30 · 95% | — / — | — / — | — | 243 |
| `components-panel-border` | #101828 · 8% | #c8ceda · 14% | — / — | — / — | — | 244 |
| `components-tooltip-bg` | #ffffff · 95% | #18181b · 95% | — / — | — / — | — | 250 |

#### 模块边框（1）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `module-border` | #101828 · 12% | #c8ceda · 16% | — / — | — / — | — | 249 |

#### 侧栏（7）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `sidebar-accent` | #171717 · 8% | #fafafa · 12% | — / — | — / — | — | 118 |
| `sidebar-accent-foreground` | #171717 | #fafafa | 13.97:1 ✅ / 13.94:1 ✅ | #e3e3e3 / #292929 | 4.5:1 | 119 |
| `sidebar-border` | #e6e6e6 | #262626 | — / — | — / — | — | 120 |
| `sidebar-foreground` | #474747 | #d1d1d1 | 8.52:1 ✅ / 12.73:1 ✅ | #f5f5f5 / #0d0d0d | 4.5:1 | 115 |
| `sidebar-primary` | #171717 | #fafafa | — / — | — / — | — | 116 |
| `sidebar-primary-foreground` | #ffffff | #171717 | — / — | — / — | — | 117 |
| `sidebar-ring` | #171717 | #fafafa | — / — | — / — | — | 121 |

#### 工作流（仅 pages/router）（19）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow-block-bg` | #fcfcfd | #27272b | — / — | — / — | — | 207 |
| `workflow-block-bg-hover` | #ffffff | #303035 | — / — | — / — | — | 214 |
| `workflow-block-bg-transparent` | #fcfcfd · 90% | #27272b · 96% | — / — | — / — | — | 208 |
| `workflow-block-border` | #ffffff | #ffffff · 8% | — / — | — / — | — | 209 |
| `workflow-block-border-highlight` | #171717 · 14% | #fafafa · 14% | — / — | — / — | — | 210 |
| `workflow-block-parma-bg` | #f2f4f7 | #ffffff · 5% | — / — | — / — | — | 211 |
| `workflow-canvas-workflow-bg` | #f2f4f7 | #1d1d20 | — / — | — / — | — | 231 |
| `workflow-canvas-workflow-dot-color` | #8585ad · 15% | #8585ad · 11% | — / — | — / — | — | 230 |
| `workflow-link-line-active` | #171717 | #fafafa | — / — | — / — | — | 219 |
| `workflow-link-line-error-active` | #f04438 | #f97066 | — / — | — / — | — | 226 |
| `workflow-link-line-error-handle` | #f04438 | #f97066 | — / — | — / — | — | 227 |
| `workflow-link-line-failure-active` | #f79009 | #fdb022 | — / — | — / — | — | 221 |
| `workflow-link-line-failure-button-bg` | #dc6803 | #f79009 | — / — | — / — | — | 223 |
| `workflow-link-line-failure-handle` | #f79009 | #fdb022 | — / — | — / — | — | 222 |
| `workflow-link-line-handle` | #171717 | #fafafa | — / — | — / — | — | 220 |
| `workflow-link-line-normal` | #d0d5dc | #676f83 | — / — | — / — | — | 217 |
| `workflow-link-line-normal-transparent` | #d0d5dc · 20% | #676f83 · 20% | — / — | — / — | — | 218 |
| `workflow-link-line-success-active` | #17b26a | #47cd89 | — / — | — / — | — | 224 |
| `workflow-link-line-success-handle` | #17b26a | #47cd89 | — / — | — / — | — | 225 |

#### 图表 / 热力 / 图标色块（19）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `chart-1` | #e76e50 | #2662d9 | — / — | — / — | — | 100 |
| `chart-2` | #2a9d90 | #2eb88a | — / — | — / — | — | 101 |
| `chart-3` | #274754 | #e88c30 | — / — | — / — | — | 102 |
| `chart-4` | #e8c468 | #af57db | — / — | — / — | — | 103 |
| `chart-5` | #f4a462 | #e23670 | — / — | — / — | — | 104 |
| `heat-0` | #ebedf0 | #2c2c32 | — / — | — / — | — | 300 |
| `heat-1` | #d6f2e6 | #0e4630 | — / — | — / — | — | 301 |
| `heat-2` | #96dfbe | #0e7048 | — / — | — / — | — | 302 |
| `heat-3` | #4cc78d | #1a9e68 | — / — | — / — | — | 303 |
| `heat-4` | #17b26a | #3ed392 | — / — | — / — | — | 304 |
| `util-colors-blue-blue-500` | #2e90fa | #2e90fa | — / — | — / — | — | 286 |
| `util-colors-blue-brand-blue-brand-500` | #085afc | #085afc | — / — | — / — | — | 284 |
| `util-colors-cyan-cyan-500` | #06aed4 | #06aed4 | — / — | — / — | — | 287 |
| `util-colors-green-green-500` | #17b26a | #17b26a | — / — | — / — | — | 288 |
| `util-colors-indigo-indigo-500` | #6172f3 | #6172f3 | — / — | — / — | — | 285 |
| `util-colors-pink-pink-500` | #ee46bc | #ee46bc | — / — | — / — | — | 292 |
| `util-colors-violet-violet-500` | #875bf7 | #875bf7 | — / — | — / — | — | 290 |
| `util-colors-warning-warning-500` | #f79009 | #f79009 | — / — | — / — | — | 289 |
| `util-colors-yellow-yellow-500` | #eaaa08 | #eaaa08 | — / — | — / — | — | 291 |

#### 其他（1）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `sidebar` | #f5f5f5 | #0d0d0d | 8.52:1 ✅ / 12.73:1 ✅ | #474747 / #d1d1d1（其上文本） | 4.5:1 | 114 |
<!-- GENERATED:colors:end -->

### 2.4 对比度实测矩阵

<!-- GENERATED:contrast:start -->
| 用途 | 前景 | 背景 | 亮色 | 暗色 | 阈值 |
| --- | --- | --- | --- | --- | --- |
| 主文本 / 卡片 | `text-primary` | `card` | 17.75:1 ✅ | 15.94:1 ✅ | 4.5:1 |
| 主文本 / 画布 | `text-primary` | `canvas` | 16.57:1 ✅ | 17.81:1 ✅ | 4.5:1 |
| 主文本 / 页面底 | `text-primary` | `background-body` | 16.11:1 ✅ | 16.26:1 ✅ | 4.5:1 |
| 次级文本 / 卡片 | `text-secondary` | `card` | 10.47:1 ✅ | 11.72:1 ✅ | 4.5:1 |
| 三级文本 / 卡片 | `text-tertiary` | `card` | 5.03:1 ✅ | 4.63:1 ✅ | 4.5:1 |
| 三级文本 / 页面底 | `text-tertiary` | `background-body` | 4.56:1 ✅ | 4.68:1 ✅ | 4.5:1 |
| 四级文本 / 卡片 | `text-quaternary` | `card` | 3.37:1 ❌ | 3.67:1 ❌ | 4.5:1 |
| 强调文本 / 卡片 | `text-accent` | `card` | 17.93:1 ✅ | 15.79:1 ✅ | 4.5:1 |
| 危险文本 / 卡片 | `text-destructive` | `card` | 4.83:1 ✅ | 5.92:1 ✅ | 4.5:1 |
| 成功文本 / 卡片 | `text-success` | `card` | 3.91:1 ❌ | 5.98:1 ✅ | 4.5:1 |
| 警告文本 / 卡片 | `text-warning` | `card` | 3.49:1 ❌ | 7.02:1 ✅ | 4.5:1 |
| 主文本 / 凹槽 | `text-primary` | `inset` | 14.89:1 ✅ | 18.79:1 ✅ | 4.5:1 |
| 三级文本 / 凹槽 | `text-tertiary` | `inset` | 4.22:1 ❌ | 4.97:1 ✅ | 4.5:1 |
| 前景 / 背景 | `foreground` | `background` | 17.18:1 ✅ | 17.95:1 ✅ | 4.5:1 |
| 卡片文本 / 卡片 | `card-foreground` | `card` | 17.93:1 ✅ | 15.79:1 ✅ | 4.5:1 |
| 浮层文本 / 浮层 | `popover-foreground` | `popover` | 17.93:1 ✅ | 12.64:1 ✅ | 4.5:1 |
| 弱化文本 / 弱化底 | `muted-foreground` | `muted` | 5.27:1 ✅ | 6.36:1 ✅ | 4.5:1 |
| 侧栏文本 / 侧栏 | `sidebar-foreground` | `sidebar` | 8.52:1 ✅ | 12.73:1 ✅ | 4.5:1 |
| 侧栏选中文本 / 选中底 | `sidebar-accent-foreground` | `sidebar-accent over sidebar` | 13.97:1 ✅ | 13.94:1 ✅ | 4.5:1 |
| 主色按钮文本 / 主色底 | `primary-foreground` | `primary` | 17.93:1 ✅ | 17.18:1 ✅ | 4.5:1 |
| 主按钮文本 / 主按钮底 | `components-button-primary-text` | `components-button-primary-bg` | 17.93:1 ✅ | 17.18:1 ✅ | 4.5:1 |
| 次按钮文本 / 次按钮底 | `components-button-secondary-text` | `components-button-secondary-bg over card` | 10.47:1 ✅ | 7.98:1 ✅ | 4.5:1 |
| 三级按钮文本 / 三级按钮底 | `components-button-tertiary-text` | `components-button-tertiary-bg over card` | 9.5:1 ✅ | 9.25:1 ✅ | 4.5:1 |
| 幽灵按钮文本 / 卡片 | `components-button-ghost-text` | `card` | 10.47:1 ✅ | 11.72:1 ✅ | 4.5:1 |
| 危险幽灵按钮文本 / 卡片 | `components-button-destructive-ghost-text` | `card` | 4.83:1 ✅ | 5.92:1 ✅ | 4.5:1 |
| 输入文本 / 输入底 | `components-input-text-filled` | `components-input-bg-normal over card` | 14.88:1 ✅ | 10.35:1 ✅ | 4.5:1 |
| 输入占位 / 输入底 | `components-input-text-placeholder` | `components-input-bg-normal over card` | 2.16:1 ❌ | 1.98:1 ❌ | 4.5:1 |
| 徽标 default 文本 / 底 | `primary-foreground` | `primary` | 17.93:1 ✅ | 17.18:1 ✅ | 4.5:1 |
| 徽标 secondary 文本 / 底 | `text-secondary` | `inset` | 8.78:1 ✅ | 13.82:1 ✅ | 4.5:1 |
| 徽标 success 文本 / 底 | `text-success` | `success ×0.1 over card` | 3.49:1 ❌ | 5.15:1 ✅ | 4.5:1 |
| 徽标 warning 文本 / 底 | `text-warning` | `warning ×0.1 over card` | 3.19:1 ❌ | 5.87:1 ✅ | 4.5:1 |
| 徽标 destructive 文本 / 底 | `text-destructive` | `destructive ×0.1 over card` | 4.17:1 ❌ | 5.56:1 ✅ | 4.5:1 |
| 徽标 info 文本 / 底 | `info` | `info ×0.1 over card` | 4.27:1 ❌ | 5.2:1 ✅ | 4.5:1 |
| 输入框边界 / 卡片 | `components-input-bg-normal` | `card` | 1.19:1 ❌ | 1.45:1 ❌ | 3:1 |
| 输入框悬停边框 / 悬停底 | `components-input-border-hover` | `components-input-bg-hover over card` | 1.33:1 ❌ | 1.15:1 ❌ | 3:1 |
| 焦点环 / 卡片 | `ring` | `card` | 17.93:1 ✅ | 15.79:1 ✅ | 3:1 |
| 禁用输入文本 / 禁用底 | `components-input-text-filled-disabled` | `components-input-bg-disabled over card` | 4.73:1 — | 4.42:1 — | —（装饰/禁用） |
| 禁用文本 / 卡片 | `text-disabled` | `card` | 1.48:1 — | 2.17:1 — | —（装饰/禁用） |
| 分隔线 / 卡片（装饰） | `border` | `card` | 1.25:1 — | 1.3:1 — | —（装饰/禁用） |
| 模块边框 / 卡片（容器，装饰） | `module-border` | `card` | 1.28:1 — | 1.47:1 — | —（装饰/禁用） |
| 浮层边框 / 浮层底（装饰） | `components-panel-border` | `components-panel-bg` | 1.17:1 — | 1.4:1 — | —（装饰/禁用） |
| 输入框底 / 页面底 | `input` | `background` | 1.2:1 — | 1.29:1 — | —（装饰/禁用） |

> 说明：`❌` 表示该模式低于阈值，`—` 表示装饰性/禁用态（不参与 WCAG 对比度门槛）。
> 半透明前景先与背景合成再计算；半透明背景先与其承载层（卡片/页面底）合成。
<!-- GENERATED:contrast:end -->

### 2.5 颜色结论

- **亮色与暗色不是镜像**：暗色的 `--color-text-tertiary` 是 alpha（`rgb(200 206 218 / 0.6)`），亮色是实色 `#676f83`；同一个角色在两种模式下用不同构造方式，跨背景的表现不可比。`[源码]`
- **背景层有两套**：shadcn 的 `--background`（98% 纯灰）与业务的 `--color-background-body`（`#f2f4f7` 蓝灰）。后者 0 引用，页面实际底色来自 `--color-sidebar`。`[生成]` 见 DS-028。
- **状态色不是一条色阶**：成功至少有 5 个值、警告 4 个、危险 3 个（见 DS-008）；文本档与实心档没有成对声明。

---

## 3. 字体

### 3.1 family

<!-- GENERATED:fonts:start -->
| Token | 值 | index.css 行 |
| --- | --- | --- |
| `--font-sans` | `'Geist Variable', sans-serif` | 64 |
| `--font-mono` | `"Source Code Pro", "SF Mono", "Fira Code", ui-monospace, SFMono-Regular,     Menlo, Monaco, Consolas, monospace` | 66 |
| `--font-heading` | `var(--font-sans)` | 125 |
<!-- GENERATED:fonts:end -->

- `--font-sans` 由 `@import "@fontsource-variable/geist"` 提供，实际 family 名是 `Geist Variable`。`[源码]`
- `--font-mono` 首位是 `Source Code Pro`，但仓库没有安装该字体；Linux 上会继续回落到 `ui-monospace` / `DejaVu Sans Mono`。`[源码]` 见 DS-020。
- `--font-heading` 直接复用 sans，没有独立标题字体。`[源码]`

### 3.2 字号阶梯（`system-*` utility）

<!-- GENERATED:typography:start -->
| Utility | 字号 | 行高 | 字重 | 大写 | 源码引用次数 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
| `system-2xs-regular` | 11px | 16px | 400 | 否 | 126 | 420 |
| `system-2xs-regular-uppercase` | 11px | 16px | 400 | 是 | 1 | 413 |
| `system-2xs-medium` | 11px | 16px | 500 | 否 | 47 | 426 |
| `system-2xs-medium-uppercase` | 11px | 16px | 500 | 是 | 11 | 432 |
| `system-2xs-semibold-uppercase` | 11px | 16px | 600 | 是 | 2 | 439 |
| `system-xs-regular` | 12px | 16px | 400 | 否 | 136 | 446 |
| `system-xs-regular-uppercase` | 12px | 16px | 400 | 是 | 1 | 452 |
| `system-kbd` | 12px | 16px | 500 | 否 | 2 | 554 |
| `system-xs-medium` | 12px | 16px | 500 | 否 | 89 | 459 |
| `system-xs-medium-uppercase` | 12px | 16px | 500 | 是 | 1 | 465 |
| `system-xs-semibold` | 12px | 16px | 600 | 否 | 7 | 472 |
| `system-xs-semibold-uppercase` | 12px | 16px | 600 | 是 | 1 | 478 |
| `system-sm-regular` | 13px | 16px | 400 | 否 | 4 | 485 |
| `system-sm-medium` | 13px | 16px | 500 | 否 | 33 | 491 |
| `system-sm-medium-uppercase` | 13px | 16px | 500 | 是 | 1 | 497 |
| `system-sm-semibold` | 13px | 16px | 600 | 否 | 3 | 504 |
| `system-sm-semibold-uppercase` | 13px | 16px | 600 | 是 | 3 | 510 |
| `system-md-regular` | 14px | 20px | 400 | 否 | 1 | 517 |
| `system-md-medium` | 14px | 20px | 500 | 否 | 5 | 523 |
| `system-md-semibold` | 14px | 20px | 600 | 否 | 4 | 529 |
| `system-md-semibold-uppercase` | 14px | 20px | 600 | 是 | 1 | 535 |
| `system-xl-medium` | 16px | 24px | 500 | 否 | 2 | 542 |
| `system-xl-semibold` | 16px | 24px | 600 | 否 | 9 | 548 |
<!-- GENERATED:typography:end -->

### 3.3 阶梯归并

| 字号/行高 | 档位 |
| --- | --- |
<!-- GENERATED:type-scale:start -->
| 11px/16px | 2xs |
| 12px/16px | xs / kbd |
| 13px/16px | sm |
| 14px/20px | md |
| 16px/24px | xl |
<!-- GENERATED:type-scale:end -->

- 字号下限是 **11px**（`--text-2xs: 0.6875rem`），注释明确“不要继续往下压”。`[源码]`
- 13px 是使用最广的正文档（`system-sm-*`），但组件里有 29 处直接写 `text-[13px] leading-4`，绕过了 utility。`[生成]` 见 DS-016。
- 行高与字号不完全是 4px 倍数：11/16、12/16、13/16、14/20、16/24 —— 行盒落在 4px 基线上，字号本身不是。`[源码]`

---

## 4. 间距

Tailwind v4 的 `--spacing` 默认 `0.25rem`（4px），仓库没有覆盖它。`[源码]`
下表按“类名步长 × 4px”换算；使用次数统计 `packages/console/source/**/*.tsx` 中的 `p/m/gap/space-*`。

<!-- GENERATED:spacing:start -->
| Tailwind 步长 | 像素 | 使用次数 | 4px 网格 | 8px 网格 |
| --- | --- | --- | --- | --- |
| 0 | 0px | 68 | ✅ | ✅ |
| 0.5 | 2px | 95 | ❌ | ❌ |
| 0.75 | 3px | 3 | ❌ | ❌ |
| 1 | 4px | 245 | ✅ | ❌ |
| 1.5 | 6px | 203 | ❌ | ❌ |
| 2 | 8px | 359 | ✅ | ✅ |
| 2.25 | 9px | 1 | ❌ | ❌ |
| 2.5 | 10px | 125 | ❌ | ❌ |
| 3 | 12px | 270 | ✅ | ❌ |
| 3.5 | 14px | 11 | ❌ | ❌ |
| 4 | 16px | 208 | ✅ | ✅ |
| 5 | 20px | 27 | ✅ | ❌ |
| 6 | 24px | 20 | ✅ | ✅ |
| 6.5 | 26px | 2 | ❌ | ❌ |
| 7 | 28px | 5 | ✅ | ❌ |
| 7.5 | 30px | 1 | ❌ | ❌ |
| 8 | 32px | 18 | ✅ | ✅ |
| 9 | 36px | 9 | ✅ | ❌ |
| 10 | 40px | 6 | ✅ | ✅ |
| 12 | 48px | 5 | ✅ | ✅ |
| 14 | 56px | 1 | ✅ | ✅ |
| 16 | 64px | 1 | ✅ | ✅ |
| 17 | 68px | 2 | ✅ | ❌ |
| 18 | 72px | 1 | ✅ | ✅ |
| 20 | 80px | 2 | ✅ | ✅ |
| 24 | 96px | 3 | ✅ | ✅ |
| 40 | 160px | 2 | ✅ | ✅ |

- 4px 网格外的步长：`0.5`（2px，95 次）、`0.75`（3px，3 次）、`1.5`（6px，203 次）、`2.25`（9px，1 次）、`2.5`（10px，125 次）、`3.5`（14px，11 次）、`6.5`（26px，2 次）、`7.5`（30px，1 次）
- 8px 网格外的步长：`0.5`、`0.75`、`1`、`1.5`、`2.25`、`2.5`、`3`、`3.5`、`5`、`6.5`、`7`、`7.5`、`9`、`17`
- 统计口径：`packages/console/source/**/*.tsx` 中的 `p/m/gap/space-*` 类名；`--spacing` 未在本仓库覆盖，取 Tailwind v4 默认 `0.25rem`。
<!-- GENERATED:spacing:end -->

**4/8 网格判定**：

- 4px 主网格：步长为整数（`1` = 4px、`2` = 8px、`3` = 12px…）。
- 8px 节奏：步长为偶数（`2` = 8px、`4` = 16px…）。
- 半档（`0.5` / `1.5` / `2.5` / `3.5`…）是 2px 网格，不是错，但目前没有登记为“hairline 例外”，无法机器校验。`[生成]` 见 DS-019。

---

## 5. 圆角

<!-- GENERATED:radii:start -->
| Token | 原始值 | 解析值 | index.css 行 |
| --- | --- | --- | --- |
| `--radius-sm` | `calc(var(--radius) - 4px)` | 2px | 70 |
| `--radius-md` | `calc(var(--radius) - 2px)` | 4px | 71 |
| `--radius-lg` | `var(--radius)` | 6px | 72 |
| `--radius` | `0.375rem` | 6px | 123 |
| `--button-radius` | `0.375rem` | 6px | 124 |
| `--radius-xl` | `calc(var(--radius) + 4px)` | 10px | 73 |
| `--radius-2xl` | `calc(var(--radius) * 1.8)` | 10.8px | 127 |
| `--radius-3xl` | `calc(var(--radius) * 2.2)` | 13.2px | 129 |
| `--radius-4xl` | `calc(var(--radius) * 2.6)` | 15.6px | 131 |
<!-- GENERATED:radii:end -->

- 基准 `--radius: 0.375rem`（6px）；`sm/md/lg/xl` 由它加减得到。`[源码]`
- `2xl/3xl/4xl` 用乘法得到 `10.8 / 13.2 / 15.6px`，不是整数，也不在任何设计系统的常见刻度上。`[生成]`
- `workflow-ui-surface` 作用域把 `rounded-md/lg/xl/2xl` 覆写成 `6/8/12/16px`，同一类名在画布内外不同值。`[源码]` 见 DS-014。
- `button` 的基础圆角是 `--button-radius`（6px），但 `xs` / `icon-xs` 档单独用 `rounded-md`（4px）。`[源码]`

---

## 6. 层次：阴影、描边、z-index

### 6.1 阴影

<!-- GENERATED:shadows:start -->
| Token | 亮色 | 暗色 | index.css 行 |
| --- | --- | --- | --- |
| `--shadow-card` | `0 1px 2px -1px rgb(16 24 40 / 0.08),     0 2px 4px -2px rgb(16 24 40 / 0.06)` | `0 1px 2px -1px rgb(0 0 0 / 0.55),       0 2px 4px -2px rgb(0 0 0 / 0.4)` | 154 |
| `--shadow-card-hover` | `0 2px 4px -2px rgb(16 24 40 / 0.10),     0 6px 12px -4px rgb(16 24 40 / 0.12)` | `0 2px 4px -2px rgb(0 0 0 / 0.55),       0 6px 12px -4px rgb(0 0 0 / 0.45)` | 157 |
<!-- GENERATED:shadows:end -->

- 只有卡片有 token；浮层用 `shadow-none` + 0.5px 边 + `backdrop-blur-[5px]`，Combobox 却用 `shadow-md`，两套并存。`[源码]` 见 DS-027。
- 主内容卡片的影子是字面值 `shadow-[0_1px_3px_rgb(0_0_0/0.06)]`，没有进 token。`[源码]` 见 DS-017。
- 暗色只覆盖了 `--shadow-card` / `--shadow-card-hover`；Tailwind 默认的 `shadow-lg/2xl` 在暗色下仍是黑投影。`[源码]`

### 6.2 z-index

<!-- GENERATED:z-index:start -->
| z 值 | 次数 | 示例 |
| --- | --- | --- |
| `z-0` | 9 | `packages/console/source/components/app-sidebar.tsx:167`<br>`packages/console/source/components/app-sidebar.tsx:179`<br>`packages/console/source/components/app-sidebar.tsx:191` |
| `z-1` | 1 | `packages/console/source/pages/router/components/node-handle.tsx:69` |
| `z-10` | 27 | `packages/console/source/components/app-sidebar.tsx:245`<br>`packages/console/source/components/layout.tsx:82`<br>`packages/console/source/components/ui/avatar.tsx:63` |
| `z-20` | 2 | `packages/console/source/components/layout.tsx:103`<br>`packages/console/source/pages/router/components/workflow-canvas-dock.tsx:37` |
| `z-30` | 4 | `packages/console/source/components/layout.tsx:57`<br>`packages/console/source/pages/overview/components/receipt-printer-preview/decorations.tsx:25`<br>`packages/console/source/pages/overview/components/receipt-printer-preview/root.tsx:34` |
| `z-40` | 1 | `packages/console/source/pages/overview/components/receipt-printer-preview/machine.tsx:32` |
| `z-50` | 25 | `packages/console/source/App.tsx:111`<br>`packages/console/source/App.tsx:111`<br>`packages/console/source/components/model-test-panel.tsx:727` |
| `z-70` | 2 | `packages/console/source/pages/overview/components/receipt-controls.tsx:78`<br>`packages/console/source/pages/overview/components/receipt-controls.tsx:120` |
<!-- GENERATED:z-index:end -->

当前没有 `--z-*` token；`z-70` 的收据控件高于 `z-50` 的对话框。`[源码]` 见 DS-013。

### 6.3 描边

- 全局 `* { border-color: hsl(var(--border)) }`，边框宽度由 Tailwind preflight 置 0，必须显式写 `border`。`[源码]`
- 模块边框 `--color-module-border` 对卡片 1.28:1，低于 3:1；它不是控件边界，属于“视觉收边”，但卡片本身几乎只靠这一条线 + 极轻阴影分离。`[生成]`
- 空态写了 `border-dashed` 却没有宽度，实际不渲染。`[源码]` 见 DS-012。

---

## 7. 动效与降级

<!-- GENERATED:motion:start -->
| 观察项 | 数值 |
| --- | --- |
| 使用 `animate-*` 的文件 | 35 |
| `animate-*` 出现次数 | 61 |
| `motion-reduce:` / `motion-safe:` 出现次数 | 17 |
| `prefers-reduced-motion` 媒体块 | 2 |
| `@keyframes` | `status-event-pulse`（index.css:764）、`log-row-enter`（index.css:791） |

| `duration-*` | 次数 |
| --- | --- |
| 100ms | 10 |
| 150ms | 5 |
| 200ms | 5 |
| 300ms | 7 |
<!-- GENERATED:motion:end -->

### 7.1 实际使用的时长

| 场景 | 时长 / 曲线 | 证据 |
| --- | --- | --- |
| 浮层开合 | `duration-100` + `fade/zoom-in-95` | `select.tsx:82`、`popover.tsx:31`、`dialog.tsx:71` `[源码]` |
| 侧栏/外壳宽度 | `duration-200 ease-out` | `layout.tsx:52` `[源码]` |
| 输入框颜色 | `120ms ease`（CSS） | `index.css:914` `[源码]` |
| 状态事件脉冲 | `700ms cubic-bezier(0.22,1,0.36,1)` | `index.css:764-788` `[源码]` |
| 日志新行 | `1100ms ease-out` | `index.css:791-806` `[源码]` |
| 主题揭示 | View Transition（无自定义时长） | `index.css:47-60` `[源码]` |

### 7.2 降级

- 只有 `.status-event-pulse`、`.log-row-enter` 与外壳宽度过渡写了 `prefers-reduced-motion: reduce`。`[源码]`
- `Skeleton` 的 `animate-pulse`、Radix 的 `data-open:animate-in`、`Sheet` 的 `transition duration-200` 都没有降级。`[源码]` 见 DS-011。
- 全仓 `animate-*` 出现在 35 个文件、61 次；`motion-reduce:` / `motion-safe:` 只有 17 次。`[生成]`

---

## 8. 断点与栅格

<!-- GENERATED:breakpoints:start -->
| 断点 | 默认最小宽度 | 源码使用次数 |
| --- | --- | --- |
| `sm:` | 640px（40rem） | 68 |
| `md:` | 768px（48rem） | 36 |
| `lg:` | 1024px（64rem） | 17 |
| `xl:` | 1280px（80rem） | 0 |
| `2xl:` | 1536px（96rem） | 6 |

> 仓库没有声明 `--breakpoint-*`，以上为 Tailwind v4 默认值；`xl` 为 0 次使用。
<!-- GENERATED:breakpoints:end -->

- 仓库没有 `tailwind.config.*`，也没有 `--breakpoint-*` 覆盖；断点就是 Tailwind v4 默认值。`[源码]`
- 实际布局依赖 `sm`（表单网格 1→2/3 列）、`md`（页面内边距 16→24px）、`2xl`（24→32px）；`xl` 完全没用。`[生成]`
- 外壳是固定栅格：侧栏展开 `14rem`、收起 `3rem`，内容列 `minmax(0,1fr)`；侧栏自身 `w-56`（14rem）。`[源码]` `layout.tsx:54`、`app-sidebar.tsx:146`
- 没有全局最大宽度；阅读宽度由页面自己写 `max-w-*`。`[源码]` `layout.tsx:71-78`

---

## 9. 组件规范

### 9.1 组件清单与状态

<!-- GENERATED:component-inventory:start -->
| 组件 | 源文件 | 关键尺寸 | 状态 | 可访问性要点 |
| --- | --- | --- | --- | --- |
| **Button** | `components/ui/button.tsx` | 32px 默认 / 28 / 24 / 36 | default · hover · active(translate-y-px) · focus-visible(ring-2) · disabled(opacity-50) · 无 loading | 原生 button；aria-invalid 有 ring；图标按钮无 aria-label 约定 |
| **Input** | `components/ui/input.tsx` | h-8；圆角 6px；13/16 | default · hover(底/边) · focus(底/边) · disabled(底/文字) · aria-invalid · 无 loading | 依赖 placeholder 提示；静止态无边框 |
| **Select** | `components/ui/select.tsx` | h-8 / min-w-36；13/16 | default · hover · focus(bg) · disabled(opacity-50) · open(浮层) | Radix 键盘语义；焦点只改底色 |
| **Badge** | `components/ui/badge.tsx` | h-5；11/16 medium；圆角 4px | 6 个静态 variant；链接态 hover；无 disabled/loading | 11px 是字号下限；状态色文本未全达标 |
| **Card** | `components/ui/card.tsx` | padding 16 / sm 12；圆角 10px | default · sm；无 hover/selected 内建 | 卡片靠 shadow-card + 画布明度差分离 |
| **Dialog** | `components/ui/dialog.tsx` | max-w-sm（384px）；p-4；圆角 10px | open · closed（fade/zoom）· 无 loading | Radix 焦点陷阱；关闭按钮 28px |
| **Table** | `components/ui/table.tsx` | th h-10；td p-2；12/16 | default · row hover · selected · expanded | 无 sticky 表头内建；页面自行加 |
| **Skeleton** | `components/ui/skeleton.tsx` | 自适应；圆角 4px | pulse（无 reduced-motion 降级） | 纯装饰，需 aria-hidden |
| **Empty** | `components/ui/empty.tsx` | p-6；圆角 10px；max-w-sm | default · icon · embedded（EmptyState） | 虚线边框宽度为 0 |
| **Toast** | `components/ui/sonner.tsx / toast.tsx` | bottom-right；默认 4000ms，error 6000ms | success · error · info · warning · loading | sonner 提供 aria-live |
| **Tooltip** | `components/ui/tooltip.tsx` | max-w-xs；12/16；圆角 4px | delayed-open · open · closed | 反色底；`components-tooltip-bg` 未使用 |
<!-- GENERATED:component-inventory:end -->

### 9.2 六态定义（本文与预览页共用）

| 状态 | 触发 | 视觉约定 | 证据 |
| --- | --- | --- | --- |
| default | 无交互 | 各自 variant 的静止底色/文字 | `button.tsx:12-18` `[源码]` |
| hover | 指针悬停 | 底色向 `*-hover` 档移动；`outline` 同时加深描边 | `button.tsx:12-18` `[源码]` |
| active | 按下 | 主按钮 `translate-y-px`；其余仅底色 | `button.tsx:8` `[源码]` |
| focus-visible | 键盘聚焦 | `ring-2 ring-state-accent-solid`（按钮）/ 1px outline（全局） | `button.tsx:8`、`index.css:717` `[源码]` |
| disabled | `disabled` | `opacity-50` + `pointer-events-none`；输入框改为独立底/文字 | `button.tsx:8`、`input.tsx:19` `[源码]` |
| loading | 调用方组合 Spinner | **没有内建档位**；无 `aria-busy` 约定 | `spinner.tsx:9` `[源码]` |

> “六态”是检查清单，不表示每个组件都实现了六态。缺失的档位就是问题，见 DS-023。

### 9.3 组件级注意点

- **Button**：默认 32px 高，四档 24/28/32/36；水平内边距 8/12/12/16。`xs` 用 4px 圆角，其余 6px。`[源码]`
- **Input**：32px 高、6px 圆角、13/16；静止态 `border-transparent`，只有 hover/focus 才显形。`[源码]`
- **Select**：触发器 32px、min-width 36；内容浮层 `min-w-36`、0.5px 边、blur。`[源码]`
- **Badge**：20px 高、11px 字、4px 圆角；`secondary` 与 `muted` 都是 `bg-inset`，只差文字档。`[源码]`
- **Card**：16px 内边距（sm 12px）、10px 圆角、`shadow-card`；footer 用 `bg-inset`。`[源码]`
- **Dialog**：`max-w-sm`、16px 内边距、10px 圆角；关闭按钮是 28px 的 icon-sm ghost。`[源码]`
- **Table**：表头 40px、单元格 8px 内边距、12/16 字；行 hover 用 `state-base-hover`，分隔线 `border-border/40`。`[源码]`
- **Skeleton**：`bg-inset` + `animate-pulse`，没有 `aria-hidden` 默认值。`[源码]`
- **Empty**：`p-6`、10px 圆角、`max-w-sm`；`EmptyState` 包装成 `min-h-44` / embedded `min-h-32`。`[源码]`
- **Toast**：sonner，右下角；默认 4000ms、error 6000ms；底部操作条场景用 `bottomOffset` 抬高。`[源码]`
- **Tooltip**：`bg-foreground` 反色底、12/16、4px 圆角；白底 token 未使用。`[源码]`

---

## 10. 布局模式

### 10.1 应用外壳

```
grid-cols-[14rem_minmax(0,1fr)]   (展开)
grid-cols-[3rem_minmax(0,1fr)]    (收起)
aside z-30 → main p-2 pl-1 → 内容卡 rounded-2xl border-0.5 shadow-arbitrary
```

- 外壳高度 `h-full`、`overflow-hidden`；只有内容区滚动。`[源码]` `layout.tsx:48-82`
- 内容卡使用 `bg-canvas`（97%），页面底/侧栏是 96% 纯灰，卡片是 100% 白：三层明度台阶。`[源码]`
- 内容区不设全局最大宽度；页面自己决定阅读宽度。`[源码]` `layout.tsx:71-78`

### 10.2 页头

- `sticky top-0 z-20`、`bg-canvas/95` + `backdrop-blur-sm`、底部 50% 透明边框。`[源码]` `layout.tsx:100-105`
- 标题 `system-xl-semibold`（16/24）；描述 `system-xs-regular` + `text-text-tertiary`；操作区右对齐、`gap-2`。`[源码]`
- 窄屏 `sm:flex-row` 才把标题与操作分到两端；默认纵向。`[源码]`

### 10.3 表格页

- `PageContent` = `grid gap-4`；表格外层 `overflow-x-auto`。`[源码]` `layout.tsx:123-131`、`table.tsx:7-16`
- 表头由页面加 `sticky top-0 z-10 bg-inset`，不是 Table 原语内建。`[源码]` `request-logs-table.tsx:103`
- 行高由 `td p-2` + 12/16 字撑出约 36px；表头 40px。行 hover / selected / expanded 三态都有。`[源码]` `table.tsx:58-88`

### 10.4 表单页

- 最小单元是 `FormField`：`grid gap-1.5`，label `system-sm-medium text-text-secondary`，错误/hint 在控件下方。`[源码]` `form-kit.tsx:57-70`
- `FormGrid` 默认 2 列：`grid-cols-1 sm:grid-cols-2`；4 列档在 `sm` 2 列、`lg` 4 列。`[源码]` `form-kit.tsx:78-91`
- 控件统一 32px 高、13/16、6px 圆角，和默认按钮同高。`[源码]`

### 10.5 抽屉 / 侧滑

- `Sheet` / `Drawer` 都是 `fixed z-50`，左右宽 `3/4`、`sm:max-w-sm`，圆角 10px。`[源码]` `sheet.tsx:74`、`drawer.tsx:57`
- 遮罩 `bg-black/10` + `backdrop-blur-xs`；抽屉头 `p-4`、底部 `mt-auto p-4 gap-2`。`[源码]`
- 进入/退出用 `slide-in-from-*` + `fade`，没有 reduced-motion 降级。`[源码]`

---

## 11. 问题清单

> 每条都有 `文件:行` 证据；数值型影响由抽取脚本实时计算，改代码后重跑会变。
> 排序：P0（用户现在就可能读不到/点不到）→ P1（一致性/可访问性缺口）→ P2（可维护性/漂移）→ P3（文档/命名）。

<!-- GENERATED:issues:start -->
### P0 · 用户现在就可能读不到/点不到（5）

| ID | 类别 | 问题 | 证据 | 影响 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
| DS-001 | 对比度 · 控件边界 | 输入框静止态没有可见边界 | packages/console/source/components/ui/input.tsx:15,17（border-transparent；hover 边框才显形）+ packages/console/source/styles/index.css:256 / packages/console/source/styles/index.css:263 | 输入底叠在白卡上实测 1.19:1（暗色 1.45:1），低于非文字控件要求的 3:1。页面里输入框只剩占位符提示位置，低视力或强光下找不到控件。 | 补一个静止态描边 token（与卡片 ≥3:1），或用更深的输入底；暗色同步。不要只靠 placeholder 承担定位。 |
| DS-002 | 对比度 · 文本 | 输入框占位符对比度不足 | packages/console/source/components/ui/input.tsx:16 + packages/console/source/styles/index.css:262 | 占位符在输入底上亮色 2.16:1、暗色 1.98:1，均低于正文 4.5:1。占位符是用户判断“这里填什么”的唯一线索。 | 把 placeholder 提到与三级文本同档并实测 ≥4.5:1；若只想做“淡提示”，应同时提供可见 label。 |
| DS-003 | 对比度 · 文本 | 四级文本被当作可读文本使用 | packages/console/source/styles/index.css:168 + packages/console/source/components/ui/empty-state.tsx:27、packages/console/source/components/ui/table.tsx:58（行分隔语境） | 四级文本亮色 3.37:1、暗色 3.67:1，低于 4.5:1；它被用于时间戳、空值占位与空态图标，属于要读的信息而不是装饰。 | 正文/时间戳改用三级文本，或把 quaternary 加深到 ≥4.5:1；仅图标与分隔符保留低对比并改名表达“装饰”。 |
| DS-026 | 对比度 · 状态文本 | 成功/警告文本在白卡上不达标 | packages/console/source/styles/index.css:176 / packages/console/source/styles/index.css:178 + packages/console/source/components/metric-card.tsx:30、packages/console/source/components/form-kit.tsx:35 | 成功文本 3.91:1、警告文本 3.49:1（亮色，阈值 4.5），用于指标卡涨跌、表单校验提示与复制成功反馈。暗色反而达标（5.98 / 7.02），说明亮色档单独偏浅。 | 把亮色 success/warning 文本各加深一档（保持与实心色同色相），或用 500/600 两档分别承担“实心/文字”。 |
| DS-005 | 对比度 · 状态徽标 | 11px 状态徽标文本有未达标档位 | packages/console/source/components/ui/badge.tsx:8,21-23 + packages/console/source/styles/index.css:176 / packages/console/source/styles/index.css:178 / packages/console/source/styles/index.css:175 / packages/console/source/styles/index.css:110 | success 3.49:1、warning 3.19:1、info 4.27:1、destructive 4.17:1（亮色，阈值 4.5）。徽标是 11px 小字，达标线没有“大字号”折扣。 | 为状态徽标单独取更深的文本档（或加深底 tint），并补齐 `--color-text-info`；不要直接用实心状态色当文字色。 |

### P1 · 系统一致性/可访问性缺口（12）

| ID | 类别 | 问题 | 证据 | 影响 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
| DS-004 | 对比度 · 文本 | 三级文本在凹槽/页面底上只剩临界余量 | packages/console/source/styles/index.css:164 + packages/console/source/components/ui/table.tsx:45（tfoot bg-inset） | 三级文本对白卡达标，但对页面底 4.56:1、对凹槽 4.22:1。凹槽上的 4.22 已低于 4.5；页面底的 4.56 只剩 0.06 余量，任何一次调色都会跌破。 | 页面级说明文字改用二级文本；三级文本按最深的背景（凹槽）校准到 ≥4.5:1，而不是只对白卡校准。 |
| DS-006 | 一致性 · 文本主色 | “主文本”有两个值：foreground 与 text-primary | packages/console/source/styles/index.css:76 / packages/console/source/styles/index.css:162 | 亮色 #171717 vs #101828，暗色 #fafafa vs #fbfbfc。两套 token 都表示最高层级文本，页面标题与正文并排时会呈现轻微冷暖差；主题切换时两套各自变化，无法用一个值校准。 | 保留一套作为唯一主文本 token，另一套改成别名（相同的值），或明确分层（正文 vs 标题）并写进规范。 |
| DS-007 | 一致性 · 中性色族 | 纯灰与蓝灰两套中性色并存 | packages/console/source/styles/index.css:163（#354052 蓝灰）vs packages/console/source/styles/index.css:184（#f2f4f7）；HSL 侧 packages/console/source/styles/index.css:114（0 0%） | 卡片/画布/侧栏来自纯灰 HSL 阶梯，文本/边框/状态来自蓝灰（Untitled UI 系）。同一屏里“灰”有两种色相，深浅台阶也不是同一条曲线。 | 选一套作为基准色族（建议保留蓝灰，纯灰只做过渡别名），把背景/边框/文本的台阶重排到同一色相与同一明度序列。 |
| DS-008 | 一致性 · 状态色 | 成功/警告/危险各有 3-5 个“同角色”色值 | success: --color-text-success=#079455 / --color-text-success-secondary=#17b26a / --color-state-success-solid=#17b26a / --color-success=#269c67 / --color-util-colors-green-green-500=#17b26a；warning: #dc6803 / #f79009 / #f79009 / #dc9209；destructive: #d92d20 / #f04438 / #ca3b2b（声明行 packages/console/source/styles/index.css:176 / packages/console/source/styles/index.css:178 / packages/console/source/styles/index.css:175） | 同一语义在文本、实心、浅底、图表中取不同红/绿/黄，跨组件并排时能看出色差；对比度也随所选档位漂移。 | 每个状态定义一条色阶（text / solid / tint / border），组件只能引用角色档位，不允许直接拿 solid 当 text。 |
| DS-009 | 完整性 · 状态族缺档 | info 没有文本档，直接拿实心色当文字 | packages/console/source/components/ui/badge.tsx:23 + packages/console/source/pages/request-logs/components/request-log-detail-row.tsx:86 + packages/console/source/styles/index.css:110 | success/warning 有 `--color-text-*`，info 缺 `--color-text-info`，于是 `text-info` 解析成实心蓝。状态族不对称，新增组件时只能复制这个例外。 | 补 `--color-text-info`（与 success/warning 同档对比度）与 `--color-info-border`，徽标改用文本档。 |
| DS-010 | 可访问性 · 焦点 | 焦点指示器有四套写法 | packages/console/source/styles/index.css:99（base 的 1px outline）/ packages/console/source/components/ui/button.tsx:8（ring-2 state-accent-solid）/ packages/console/source/components/ui/select.tsx:48（focus:bg 改底色）/ packages/console/source/components/ui/input.tsx:18（focus:border 改边框，使用 packages/console/source/styles/index.css:264） | 键盘用户在不同控件上看到不同宽度、不同颜色、不同位置的焦点；输入框聚焦时甚至只改底色，没有可见环。 | 统一一个 `--focus-ring-width` / `--focus-ring-color` / `--focus-ring-offset` 三件套，所有可聚焦控件只引用它；底色变化作为附加而不是替代。 |
| DS-011 | 可访问性 · 动效降级 | 动效降级只覆盖了少数动画 | packages/console/source/components/ui/skeleton.tsx:7（animate-pulse 无降级）/ packages/console/source/components/ui/dialog.tsx:71（Radix data-open 动画无降级）/ packages/console/source/styles/index.css:698-711（只有 pulse 与 log-row 有 reduced-motion） | 开启“减少动态效果”的用户仍会看到骨架呼吸、浮层缩放、列表滑入；前庭敏感用户无法关闭。 | 在 base 层统一 `@media (prefers-reduced-motion: reduce)` 关闭 animation/transition（保留 opacity 的即时切换），并为 Skeleton 提供静态占位样式。 |
| DS-012 | 视觉 · 空态 | 空态容器的虚线边框没有宽度，实际不渲染 | packages/console/source/components/ui/empty.tsx:10（`border-dashed`，无 `border` / `border-*` 宽度） | Tailwind preflight 把所有元素 border-width 置 0；只写 border-style 不会画出线。空态因此变成一个没有边界的留白块，和“内容缺失”难以区分。 | 补 `border border-border`（或 `border-module-border`），并确认暗色下的对比度；若本来不想画边框，删掉 `border-dashed` 以免误导。 |
| DS-013 | 体系 · 层级 | z-index 没有标度，浮层顺序靠数字大小猜 | z-index 使用值：0(9) / 1(1) / 10(27) / 20(2) / 30(4) / 40(1) / 50(25) / 70(2)；packages/console/source/pages/overview/components/receipt-controls.tsx:78（z-70）高于 dialog 的 z-50 | 没有“base / sticky / sidebar / overlay / modal / toast”的命名层，新增浮层只能比大小；z-70 的收据控件会盖住 z-50 的对话框。 | 在 `@theme` 定义 `--z-*` 六档并只允许引用 token；收据全屏场景单独一档（如 z-80）并在文档登记。 |
| DS-014 | 体系 · 圆角 | 圆角刻度出现非整数与作用域覆写 | --radius-sm=2px / --radius-md=4px / --radius-lg=6px / --radius=6px / --button-radius=6px / --radius-xl=10px / --radius-2xl=10.8px / --radius-3xl=13.200000000000001px / --radius-4xl=15.600000000000001px；packages/console/source/styles/index.css:880-903（workflow-ui-surface 覆写为 6/8/12/16） | xl=10px 与 2xl=10.8px 肉眼无差别却占两档；同一 `rounded-2xl` 在主界面是 10.8px、在工作流画布是 16px。组件无法预测“大圆角”到底多大。 | 把刻度收成整数阶（2/4/6/8/12/16），删除 10.8/13.2/15.6；工作流若必须还原上游，使用独立命名（`--radius-workflow-*`）而不是覆写通用类。 |
| DS-027 | 一致性 · 浮层 | 浮层有两套视觉：毛玻璃细边 vs 实底阴影 | packages/console/source/components/ui/select.tsx:82、dropdown-menu.tsx:46、popover.tsx:31（0.5px 边 + blur + shadow-none）vs packages/console/source/components/ui/combobox.tsx:115（bg-popover + shadow-md + ring-1） | 同一层级的浮层，Select/Dropdown/Popover 靠半透明毛玻璃，Combobox 靠实底与阴影；并排打开时高度、边界、背景都不同，暗色下毛玻璃还会透出下层文字。 | 选定一套浮层外观（建议统一到 `bg-components-panel-bg-blur` + 1px 边 + 一档 `--shadow-overlay`），Combobox 改为同一套。 |
| DS-028 | 完整性 · 页面底色 | 页面底色 token 全部零引用，body 实际用侧栏色 | packages/console/source/styles/index.css:184、packages/console/source/styles/index.css:185 等 6 个 background token；packages/console/source/styles/index.css:691（body 使用 bg-sidebar） | `background-body` 看起来是“页面底色”的权威 token，但 0 引用；页面实际底色来自 `--color-sidebar`（96% 纯灰）。读者会引错 token，且页面底色与侧栏永远同色，无法独立调整。 | 把 body 改为 `bg-background-body`，侧栏单独用 sidebar token；删除或改名其余未采用的 background-default 系列。 |

### P2 · 可维护性与漂移（10）

| ID | 类别 | 问题 | 证据 | 影响 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
| DS-015 | 卫生 · 未引用 token | 44 个已声明 token 在源码里找不到引用 | packages/console/source/styles/index.css:184；packages/console/source/styles/index.css:185；packages/console/source/styles/index.css:188；packages/console/source/styles/index.css:189；packages/console/source/styles/index.css:186；packages/console/source/styles/index.css:187；packages/console/source/styles/index.css:100；packages/console/source/styles/index.css:101；packages/console/source/styles/index.css:102；packages/console/source/styles/index.css:103；packages/console/source/styles/index.css:104；packages/console/source/styles/index.css:272 等 44 处 | 读者无法区分“预留的语义档”与“改名后忘了删的死 token”；守卫也无法判断新增 token 是否真的被使用。 | 逐个确认：删除死 token，或加 `reserved` 注释并进白名单；白名单必须写理由。 |
| DS-016 | 卫生 · 字面字号 | 13px/12px 字号在 29 处绕过排版 utility | packages/console/source/components/ui/button.tsx:8、input.tsx:15、select.tsx:48、tabs.tsx:66、dropdown-menu.tsx:46 等 | `system-sm-regular` 已经定义了 13px/16px，但组件直接写 `text-[13px] leading-4`。字号阶梯的权威从 token 变成散落的字面值，改一档要改几十处。 | 把组件里的字面字号替换为 `system-*` utility；确实需要新档位时先加到 `@utility` 再引用。 |
| DS-017 | 卫生 · 字面色值 | 非插图场景仍有字面色值与影子 | packages/console/source/components/layout.tsx:69（`shadow-[0_1px_3px_rgb(0_0_0/0.06)]`）/ packages/console/source/pages/overview/components/trend-chart.tsx:14-18（4 个系列色）/ packages/console/source/pages/overview/components/bill-content.tsx:92（印章 #e23f35）/ packages/console/source/pages/tray/page.tsx:88（窗口阴影） | 共 44 处字面颜色出现点（含插图/注释）。非插图处无法跟随主题，也无法被对比度守卫覆盖；趋势图 5 条线里 1 条用 token、4 条用字面值。 | 趋势图迁到 `--color-chart-*`（当前 0 引用）；主内容卡片删除影子或登记 `--shadow-*`；印章改用 destructive；托盘窗口影子保留为已登记例外。 |
| DS-029 | 卫生 · 死 token | tooltip 与 hover 阴影 token 声明了但没人用 | packages/console/source/styles/index.css:250 / packages/console/source/styles/index.css:157 | Tooltip 实际用 `bg-foreground`（反色黑底），白色 tooltip 底 token 从未生效；Card 也没有 hover 抬升，`shadow-card-hover` 是死档。规范里会写出“tooltip 是白底”“卡片可悬浮”的错误结论。 | 删除两个 token，或在实现里真正接上（tooltip 若要反色，就删白底 token 并改名为 `tooltip-inverse-*`）。 |
| DS-018 | 体系 · 阴影 | 阴影只有卡片两档，其余用 Tailwind 默认值 | packages/console/source/styles/index.css:154 / packages/console/source/styles/index.css:157；packages/console/source/components/model-test-panel.tsx:727（shadow-lg）、:1052（shadow-2xl） | 卡片有专门 token，浮层/面板却用 Tailwind 默认 lg/2xl；暗色只覆盖了 card，其他影子在暗色下仍是黑色重影，或干脆 shadow-none 靠边框。 | 定义 `--shadow-overlay` / `--shadow-panel` 两档并给暗色值；组件只允许引用这两档或 card 档。 |
| DS-019 | 体系 · 间距 | 间距大量落在 2px 网格而不是 4/8 网格 | 0.5(2px)×95、1.5(6px)×203、2.5(10px)×125、3.5(14px)×11；例：packages/console/source/components/ui/tabs.tsx:66（gap-1.5 / px-1.5 / py-0.5）、packages/console/source/components/ui/alert-dialog.tsx:76（gap-1.5） | 4px 网格上只有 19 个刻度，另 8 个是 2px 半档（0.5 / 0.75 / 1.5 / 2.25 / 2.5 / 3.5 / 6.5 / 7.5）。半档不是错，但没有登记为“hairline 例外”，无法机器校验，组件对齐只能靠人眼。 | 明确两档网格：4px 主网格 + 2px 仅用于描边/图标内衬；把例外写进规范并让 lint 只允许白名单。 |
| DS-020 | 体系 · 字体 | mono 字体声明了但没有随包提供 | packages/console/source/styles/index.css:66 + package.json:54（只安装 「@fontsource-variable/geist」） | `Source Code Pro` 未随应用分发；Linux 上回落到 DejaVu Sans Mono，代码块字宽、行高与 macOS 不一致，截图对比会出现“同一段代码换行不同”。 | 安装并引入 Geist Mono（与 sans 同族），或把 `ui-monospace` 放到声明首位并接受平台差异。 |
| DS-021 | 卫生 · 状态构造 | 禁用态亮色用实色、暗色用 alpha，跨背景不一致 | packages/console/source/styles/index.css:180 + packages/console/source/styles/index.css:261 | 亮色禁用文本是固定 #d0d5dc；暗色是 30% alpha。禁用态虽豁免对比度，但同一条“禁用”规则在卡片、凹槽、浮层上会呈现不同深浅，暗色尤其明显。 | 两套都用 alpha 或都用实色，并固定在“对卡片”的基准上；文档写明禁用态不参与对比度门槛。 |
| DS-022 | 卫生 · 重复 token | 两个底色 token 在一种模式下与相邻档完全相同 | packages/console/source/styles/index.css:187（暗色 #222225 = default）、packages/console/source/styles/index.css:189（亮色 #ffffff = default） | `subtle` 在暗色没有更“微妙的底”，`dodge` 在亮色没有“提亮”；调用方以为换了一档，实际颜色不变。 | 要么给出真实的相邻明度值，要么删除并在规范里说明该档不存在。 |
| DS-023 | 完整性 · 组件状态 | Button 没有 loading 档，disabled 会连 spinner 一起变淡 | packages/console/source/components/ui/button.tsx:29-39（只有尺寸档）+ packages/console/source/components/ui/spinner.tsx:9 | 加载中只能由调用方塞 Spinner；`disabled:opacity-50` 会把 spinner 与文字一起降到 50%，在浅底上几乎看不见，也没有 `aria-busy` 约定。 | 增加 `loading` prop（内部渲染 Spinner、设置 aria-busy、保留按钮宽度）；loading 态不要套用 disabled 的透明度。 |

### P3 · 文档与命名（2）

| ID | 类别 | 问题 | 证据 | 影响 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
| DS-024 | 文档 · 漂移 | 既有规格文档的行号与 token 计数已过期 | apps/docs/specs/design/design-system-tokens.md:107-108（引用 index.css:64/66，实际为 65/67） | 读者按行号跳转会落在 `@theme` 外；文档声称的 token 计数与当前抽取结果不一致，无法作为验收依据。 | 规格文档改为引用 token 名而非行号，或由本抽取脚本生成行号表；把计数交给 `tokens.generated.json`。 |
| DS-025 | 命名 · 语义 | `text-inverted` 与 `primary-foreground` 语义重叠 | packages/console/source/styles/index.css:181 + packages/console/source/styles/index.css:88 | 两者都表示“反色文本”，亮色一个 #000、一个 #fff，方向相反；调用方很难判断该用哪个。 | 删除 `text-inverted` 或在规范里定义它只用于“反色块上的文字”，并与 primary-foreground 保持同值。 |
<!-- GENERATED:issues:end -->

### 11.1 token 引用完整性

<!-- GENERATED:inventory:start -->
### 已声明、源码中零引用（44）

- `--color-background-body`（index.css:184）
- `--color-background-default`（index.css:185）
- `--color-background-default-dimmed`（index.css:188）
- `--color-background-default-dodge`（index.css:189）
- `--color-background-default-hover`（index.css:186）
- `--color-background-default-subtle`（index.css:187）
- `--color-chart-1`（index.css:100）
- `--color-chart-2`（index.css:101）
- `--color-chart-3`（index.css:102）
- `--color-chart-4`（index.css:103）
- `--color-chart-5`（index.css:104）
- `--color-components-button-secondary-accent-text`（index.css:272）
- `--color-components-option-card-option-bg`（index.css:234）
- `--color-components-option-card-option-bg-hover`（index.css:236）
- `--color-components-option-card-option-border`（index.css:235）
- `--color-components-option-card-option-border-hover`（index.css:237）
- `--color-components-option-card-option-selected-bg`（index.css:238）
- `--color-components-tooltip-bg`（index.css:250）
- `--color-destructive-foreground`（index.css:96）
- `--color-info-foreground`（index.css:111）
- `--color-secondary-foreground`（index.css:90）
- `--color-sidebar-border`（index.css:120）
- `--color-sidebar-primary-foreground`（index.css:117）
- `--color-sidebar-ring`（index.css:121）
- `--color-state-base-handle-hover`（index.css:196）
- `--color-state-warning-solid`（index.css:201）
- `--color-success-foreground`（index.css:107）
- `--color-text-accent-secondary`（index.css:174）
- `--color-text-inverted`（index.css:181）
- `--color-text-success-secondary`（index.css:177）
- `--color-text-warning-secondary`（index.css:179）
- `--color-warning-foreground`（index.css:109）
- `--color-workflow-block-bg-transparent`（index.css:208）
- `--color-workflow-block-border`（index.css:209）
- `--color-workflow-block-border-highlight`（index.css:210）
- `--color-workflow-link-line-error-active`（index.css:226）
- `--color-workflow-link-line-failure-active`（index.css:221）
- `--color-workflow-link-line-failure-button-bg`（index.css:223）
- `--color-workflow-link-line-failure-handle`（index.css:222）
- `--color-workflow-link-line-normal-transparent`（index.css:218）
- `--color-workflow-link-line-success-active`（index.css:224）
- `--radius-3xl`
- `--radius-4xl`
- `--shadow-card-hover`

### 动态引用白名单（20）

| Token | 理由 |
| --- | --- |
| `--color-heat-0` | usage-heat-grid 用 `bg-heat-${level}` 动态拼接，静态扫描不可见 |
| `--color-heat-1` | 同上 |
| `--color-heat-2` | 同上 |
| `--color-heat-3` | 同上 |
| `--color-heat-4` | 同上 |
| `--color-util-colors-blue-brand-blue-brand-500` | provider-icon 由数据表动态拼接类名 |
| `--color-util-colors-indigo-indigo-500` | 同上 |
| `--color-util-colors-blue-blue-500` | 同上 |
| `--color-util-colors-cyan-cyan-500` | 同上 |
| `--color-util-colors-green-green-500` | 同上 |
| `--color-util-colors-warning-warning-500` | 同上 |
| `--color-util-colors-violet-violet-500` | 同上 |
| `--color-util-colors-yellow-yellow-500` | 同上 |
| `--color-util-colors-pink-pink-500` | 同上 |
| `--normal-bg` | sonner 内部消费，声明在 sonner.tsx 的 style 对象 |
| `--normal-text` | sonner 内部消费，声明在 sonner.tsx 的 style 对象 |
| `--normal-border` | sonner 内部消费，声明在 sonner.tsx 的 style 对象 |
| `--border-radius` | sonner 内部消费，声明在 sonner.tsx 的 style 对象 |
| `--color-bg` | chart.tsx 运行时注入给 Recharts 的指示器底色 |
| `--color-count` | latency-distribution.tsx 运行时注入给 Recharts 的系列色 |

### 未声明却被 `var()` 引用（2）

- `--token`：`packages/console/source/design-system.guard.test.ts:61`、`packages/console/source/design-system.guard.test.ts:61`
- `--x`：`packages/console/source/design-system.guard.test.ts:94`

### 样式表内 `var()` 缺声明（0）

- 无

> 第三方运行时变量（`--radix-*`、`--tw-*`、Base UI 的 `--anchor-*`）已登记在抽取脚本的白名单里，见 `scripts/design-system/extract-tokens.mjs`。
<!-- GENERATED:inventory:end -->

---

## 12. 未核实与待拍板

### 12.1 未核实（不能当结论用）

<!-- GENERATED:open-questions:start -->
### 未核实（6）

| # | 项 | 为什么没核实 | 怎么核实 |
| --- | --- | --- | --- |
| 1 | 上游工作流设计系统的版本与来源 | index.css 注释称色板/排版“取自上游工作流编辑器”，仓库内没有 vendored 源或版本号；无法核对 6/8/12/16 圆角覆写是否仍与上游一致。 | 找到上游包与 commit，或删除“逐字落地”表述。 |
| 2 | 暗色四级文本的实际背景分布 | 抽取脚本按“对卡片”计算对比度；暗色下四级文本也出现在 canvas/inset/浮层上，未逐处实测。 | 对每个使用点取实际父层背景重算，或统一限制在卡片上使用。 |
| 3 | 系统字体在 Windows/Linux 的最终回落 | 本机 headless Chrome 只能验证容器内字体；`Source Code Pro`、`SF Mono` 在目标机器上是否存在未核实。 | 在三平台各跑一次 document.fonts.check 与截图对比。 |
| 4 | 图表配色的色盲可辨性 | trend-chart 的 5 条系列里 4 条是字面色值（#0891b2 / #64748b / #14b8a6 / #f59e0b），未做 CVD 模拟；chart-1..5 目前 0 引用。 | 用 deuteranopia/protanopia 模拟，或直接采用已做无障碍校验的图表色板。 |
| 5 | 触控目标在真机上的可点性 | 按钮最小档 h-6（24px）刚好等于 WCAG 2.5.8 的最小值；实际触摸热区、间距是否足够未在真机验证。 | 在 iOS/Android 真机用 24px 图标按钮做点按测试。 |
| 6 | 对比度计算的色彩空间 | 全部按 sRGB 相对亮度计算，未考虑 OS 级对比度增强、P3 广色域与半透明叠层的实际合成差异。 | 在目标显示器与系统设置下抽样复核。 |

### 待拍板（9）

| # | 决策 | 选项 | 为什么必须拍板 |
| --- | --- | --- | --- |
| 1 | 中性色族选哪一套 | A. 蓝灰（#101828 系，现状文本/边框）为准，纯灰 HSL 降级别名；B. 纯灰为准，重做文本/边框；C. 保留双轨但明确分层。 | 同一屏出现两种灰，且台阶曲线不同；不拍板就无法统一对比度基线。 |
| 2 | 主文本 token 归并到哪一个 | `--color-foreground`（当前 #171717）或 `--color-text-primary`（当前 #101828）。 | 两者都是“最高层级文本”，必须留一个权威值，另一个做别名。 |
| 3 | 工作流圆角是否继续覆写通用刻度 | A. 保留独立 `--radius-workflow-*`；B. 并入主刻度并接受与上游的视觉差；C. 整个画布隔离为独立主题。 | 当前 `rounded-2xl` 在画布内外是 16px 与 10.8px 两个值，组件无法预测。 |
| 4 | 是否为 info 补齐完整状态族 | 补 `text-info` / `info-border` / `info-tint`，或把 info 降级为“仅实心提示”并禁止当文字。 | 当前 badge 与请求详情直接拿实心 info 当文字，对比度与语义都不稳定。 |
| 5 | 是否引入 Geist Mono | 随包引入（体积 +1 字体文件），或接受平台 mono 差异。 | 代码块跨平台字宽不一致，影响截图对比与对齐。 |
| 6 | 2px 半档是否合法化 | A. 登记为 hairline 例外（描边/图标内衬）；B. 全部收敛到 4px；C. 只在密度更高的表格区允许。 | 当前 8 个刻度落在 2px 网格，不登记就无法自动校验。 |
| 7 | 插图/导出场景的字面色值是否永久例外 | A. 保留并登记（收据、账单导出、品牌 logo）；B. 抽成 `--color-illustration-*`。 | 这些值不跟随主题是有理由的，但目前只存在于评论与旧文档，守卫无法区分“例外”与“漏改”。 |
| 8 | z-index 是否 token 化 | 定义六档（base/sticky/sidebar/overlay/modal/toast）并全量替换。 | 当前 z-70 高于 dialog z-50，层级冲突只能靠读代码发现。 |
| 9 | chart-1..5 保留还是删除 | 迁移趋势图到 chart token，或删除 5 个死 token。 | 声明了 5 个图表色但 0 引用，趋势图另有一套字面色。 |
<!-- GENERATED:open-questions:end -->

---

## 附录 A：怎么读预览页

1. 直接双击 `docs/design-system/index.html`（`file://` 可用，不需要服务器）。
2. 右上角切换明/暗；右侧目录跳到各章；右下角“回到顶部”。
3. 色板：悬停显示 token 名，点击复制 `var(--token)`；每个色块下方是实测对比度与量对底色。
4. token 总表支持搜索（token 名或色值）。
5. 问题清单按 P0/P1/P2/P3 分组；点击证据可看到 `文件:行`。

## 附录 B：重新生成

```bash
node scripts/design-system/extract-tokens.mjs
pnpm exec vitest run packages/console/source/design-system.guard.test.ts
```

脚本只写 `docs/design-system/` 下的三个文件；不会改组件、不会改运行时样式。
