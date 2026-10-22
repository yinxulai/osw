# 控制台架构：业务逻辑与 React 的分工

控制台（`packages/console/source`）只有一条硬约束，其余都从它推出来：

> **业务逻辑不认识 React；React 只是渲染层。**

这条约束不是风格偏好，它决定了一件事——**能不能在没有浏览器的情况下验证一个行为**。诊断执行器要保证「连点两下不会打两批请求出去」、「取消不是失败」，路由规划要保证「同名节点不会互相覆盖」，绑定表要保证「绑定关着时规则也关着」。这些判断全是业务规则，如果它们长在 `useEffect` 和组件状态里，就只能靠点界面来验证；写成不依赖 React 的模块之后，它们各有一份直接的单元测试。

这条约束由 `packages/console/scripts/check-console-layers.mjs` 在 `pnpm lint` 里强制，不是靠自觉（见 §5）。

## 1. 五层与各自能做什么

分层按**依赖方向**划分，不按目录名字划分。同一层的文件之间可以互相 import；跨层只能从下往上要，不能从上往下要。

| 层 | 位置 | 认识什么 | 不认识什么 |
| --- | --- | --- | --- |
| 组装层 | `App.tsx`、`main.tsx`、`routing/`、`pages/*/page.tsx` | 路由、查询客户端、页面拼装、把层与层接起来 | —— |
| 视图层 | `components/`、`pages/*/components/` | React、UI kit、`useTranslation` | `@/api/*`（除类型）、`@tanstack/react-query`（除 `useQueryClient`） |
| 绑定层 | `data/`、`hooks/`、`store/` | React 的取数与状态原语、`@/api/*` | 布局、组件、样式 |
| 领域层 | `lib/`、`catalog/`、`platform/`、`pages/*/lib/` | 纯 TS、业务规则、必要时调 `@/api/*` | **React**、`zustand`、`@tanstack/react-query`、`@/components`、`@/hooks`、`@/shell`、`@/routing` |
| 传输层 | `api/` | `fetch`、契约类型、`unwrap` | React、UI 状态库、上面任何一层 |

**视图层不认识传输层**是这一节最容易被违反、也最值钱的一条。组件一旦能直接 `import { providerModelApi }`，它就会开始自己拼请求、自己 `unwrap`、自己 `try/catch` 弹 toast，而这些逻辑串在组件的生命周期里之后就无法单独验证。所以取数一律下沉到 `data/`：组件只说「我要这个模型的绑定」，不说「去哪个接口拿」。

**领域层不认识 React** 是同一条约束的另一半。领域模块用普通函数与普通类写，React 侧只负责把它的结果画出来、把用户动作调回去。

### 命名约定

- `data/xxx.ts` —— 一个「域」的取数与写入口，内部用 react-query。导出的都是 `useXxx` 查询 hook 与 `xxxAction` 写函数。
- `lib/xxx.ts` —— 纯领域模块：纯函数，或带 `subscribe`/`getSnapshot` 的普通类。测试文件与它并列放在同一目录。
- `pages/<page>/lib/xxx.ts` —— 只服务一个页面的领域规则。够小就别往 `lib/` 提，够用两次就提。

## 2. 有状态但不属于 React：普通类 + 订阅

界面之外仍然有「状态」与「随时间演进的过程」，比如：诊断任务队列跑到了第几个、实时流断线后重连到第几次、轮询在哪些页面之间共享。这些**不是** React 状态，它们有自己的生命周期，必须在组件挂载之前就存在、在组件卸载之后还能被读取。

写法固定为**普通类 + `subscribe`/`getSnapshot`**，不写 `useXxx` 自定义 hook 来承载逻辑：

```ts
export class ModelTestRunner {
  subscribe(listener: () => void): () => void { /* … */ }
  getSnapshot(): ModelTestRunnerSnapshot { /* 稳定引用：没变就返回同一个对象 */ }
  run(tasks: TestTask[], options: TestRunOptions): Promise<void> { /* … */ }
}
```

理由：

- **可测**。`pages/model-management/lib/model-test-runner.test.ts` 直接 `new ModelTestRunner(...)`，让请求挂住、决定它什么时候回、断言并发与取消语义，全程没有 React。
- **可被多处使用**。同一个实例可以同时喂给主界面与托盘面板；hook 做不到这件事——每个 `useXxx` 都是一份新的状态。
- **生命周期不绑在渲染上**。组件卸载不该让正在花钱的诊断任务消失。

`getSnapshot` 必须返回**稳定引用**：没有变化时返回同一个对象，否则 `useSyncExternalStore` 会无限重渲染。

React 一侧只留一个薄适配（`useSyncExternalStore(runner.subscribe, runner.getSnapshot)`），适配里不写任何判断。

## 3. 三条数值口径

这三条在这里展开是因为它们几乎总被写错，而且写错之后没人看得出来。

**只写上下限里「真有必要」的那一个，绝不给用户可配置的参数加上限。** 用户想给某条规则设 600 秒超时，那是他的判断，不是我们的事。缺省值要给，上限不给——除非协议的物理边界（比如某个字段在协议里就是 32 位整数）。

**不知道的值是 `null`，不是 `0`。** 用量还没算出来、耗时还没有样本时，`0` 会被下游当成「测到了，结果为零」。`null` 会一路传到界面上变成「—」。同理，`error: null` 表示「没失败」，`error: ''` 表示「失败了但说不出原因」——这两件事在界面上要显示成不同的东西。

**协议名写全称。** `OpenAI Completions` / `OpenAI Responses` / `Anthropic Messages`，不写 `openai`、`responses`、`anthropic`。这三个名字会直接出现在用户面对的错误信息与日志里，缩写会让人分不清是哪一种。

## 4. 状态放在哪：三种寿命

界面上的状态混着放就会互相污染，判据只有一句：**关掉窗口之后它该不该还在？**

| 哪一类 | 例子 | 落在哪 | 活多久 |
| --- | --- | --- | --- |
| 服务端事实 | 供应商、模型、逻辑模型、设置 | 数据库 / 管理 API（`@/api/*`） | 永久，跟着数据走、跟着账号同步 |
| 本机偏好 | 主题、语言、侧边栏是否钉住、诊断参数 | `createPersistedStore({ scope: 'machine' })` → `localStorage` | 永久，只在这台机器 |
| 页面临时数据 | 筛选条件、页码、展开的是哪一条 | `createPageScratchStore`（`scope: 'window'` 的薄封装）→ `sessionStorage` | 这个窗口 |

第三条的「这个窗口」是精确的：重载（F5、自动更新后重进）还在，关掉窗口就没了。这正好是「我刚才在看什么」的寿命——存成永久偏好之后，用户几天后打开会看到一份自己早已忘记的筛选条件，并把「筛完什么都没有」当成「真的什么都没有」，这是最难自查的一类界面缺陷。

**所有持久化配置只有一份实现：`store/persisted-store.ts` 的 `createPersistedStore`。** 两档寿命对应它的 `scope` 取值，而「存在哪块 storage」不再由各个 store 自己挑——写成枚举是因为「存在哪」和「关掉窗口该不该还在」本来就是同一个判断，分开写迟早会写出两套互相矛盾的结论。

```ts
// 本机偏好
export const useAppUiStore = createPersistedStore<AppUiState, PersistedAppUiState>({
  key: 'osw-ui',
  scope: 'machine',
  create: set => ({ /* 普通 zustand store */ }),
  pick: state => ({ themeMode: state.themeMode, sidebarPinned: state.sidebarPinned }),
  defaults: { themeMode: 'system', sidebarPinned: false },
}).store

// 页面临时数据：同一套规则 + 键名前缀 + 批量清场
export const useLogsUiStore = scratch.store   // scratch = createPageScratchStore({ page: 'logs', … })
```

`pick` 只挑「重进这一页还该看见」的项。翻页、搜索词、`live` 这类由路由或用户动作决定、挂载时必然被重新算出来的字段放进去只会让人以为它有用——存下来也会在下一次挂载的第一帧被擦掉。

四件事因此只有一份实现：**挑哪块 storage**（探测不到就退回内存，界面照常能用）、**旧存档回落**（`pick` 与 `defaults` 分开声明，存档缺字段时填默认值而不是 `undefined`，对象再往里合一层）、**存档形状对不上时的取舍**（例如本该是对象却存成了字符串，就整份用默认值）、**复位**（`reset` 从 `getInitialState()` 取，各页面不手抄一份 `setState({ … })` 等着以后漏掉新加的字段）。

`store/page-scratch.ts` 只是在这层之上补两件只跟页面有关的事：**键名前缀**（`osw-scratch:<page>`）与**批量清场**。清场有两个入口：`clearPageScratch(page)` 清一页，`clearAllPageScratch()` 清全部（只删 `osw-scratch:` 前缀的键，不碰 `localStorage`）。后者挂在错误边界的「重新加载应用」上：崩掉的那一页按定义还记着崩溃时那份筛选，原样重载很可能一脚踩回同一个状态里，用户看到的就是「重载也没用」。

**不进临时草稿的两类东西**，写新页面时别顺手放进去：

- **服务端事实的草稿**。`pages/runtime-settings/store.ts` 的 `draft` 是用户改了一半、还没保存的设置。存下来，下次启动会把一份**没被任何地方承认过的**值画成当前设置。
- **瞬时界面动作**。`hooks/use-route-mode.ts` 的「对话框开着」「正在切页」属于正在发生的事，重新打开一个「对话框还开着」的界面没有意义。

## 5. 约束怎么被强制

`packages/console/scripts/check-console-layers.mjs` 在 `pnpm lint` 里跑，扫 `packages/console/source` 下除测试文件外的全部源码，把相对路径统一折成别名再比对。违反即退出码 1，并在输出里指明**文件、规则、以及为什么这条规则存在**。

它只守三条边界：

| 规则 | 范围 | 禁止 |
| --- | --- | --- |
| `transport` | `api/**` | React、UI 状态库、`@/(components\|pages\|data\|hooks\|store\|shell\|routing)` |
| `domain` | `lib/**`、`catalog/**`、`platform/**`、`pages/*/lib/**` | React、`zustand`、`@tanstack/react-query`、`@/(components\|hooks\|shell\|routing)`、`@/data` |
| `view` | `components/**`、`pages/*/components/**` | `@/api`（类型导入除外）、`@tanstack/react-query`（`useQueryClient` 除外） |

**为什么只有三条。** 曾经写过第四条「层间 import 顺序」，要求任何文件只能 import 比自己低的层。它在真实代码上产生了一百多条噪声——hook 之间天然互相依赖，`data/` 里的一个查询会用到另一个 `data/` 里的查询，这些都是同层依赖，不是违规。一条护栏如果多数命中都是误报，它就会被人关掉，然后连同真正的问题一起消失。所以这里只留**能被一句话讲清、且违反时一定是错的**那三条。

新增约束前先问：这条规则的每个命中，是不是都真的是缺陷？如果不是，改规则，不要改代码。

### 第二条闸门：视图层不许再长逻辑

上面那条管的是 import，管不到另一件更常见的事：**一段纯逻辑直接写进 `.tsx`**。它不违反任何 import 规则——`getTestableProtocols()` 在 `components/model-test-panel.tsx` 里算了很久，直到要把同一套判断搬到 CLI 或托盘上，才发现它跟一个具体组件长在了一起。

`packages/console/scripts/check-console-view-purity.mjs` 守这个特征，同样挂在 `pnpm lint` 与 `pnpm lint:layers` 上：

| 规则 | 判据 | 违反时 |
| --- | --- | --- |
| 视图不持有模块级状态 | `.tsx` 里不得出现模块作用域的 `let` / `var` | 失败，并指出变量名 |
| 逻辑单元只准降不准升 | 每个 `.tsx` 的模块作用域普通函数（小写名、非 `useXxx`）不超过 `scripts/view-logic-budget.json` 记的数；**新文件按 0 起算** | 失败，列出全部函数名并指向 `lib/` |

逻辑单元用账本而不是一律归零：现存那几十个一行格式化函数是历史，一次搬完是无关重构，而且会让这条规则在落地当天就红。账本把现状记下来，数字只准往下改；于是「往组件里再塞一个纯函数」第一次变成会失败的操作——要加逻辑，就去 `lib/` 或页面自己的 `lib/` 加，并顺手补一个不渲染 React 的单测。

参考实现在 `lib/model-test/`（`selection` / `results` / `config`）：它们从 `components/model-test-panel.tsx` 里搬出来，面板只剩渲染与 props 订阅，三份测试的 52 条断言全部不挂组件树。

## 6. 参考实现

| 主题 | 位置 |
| --- | --- |
| 有状态领域模块的标准写法 | `pages/model-management/lib/model-test-runner.ts` + 同名 `.test.ts` |
| 一个域一个取数入口 | `data/logical-models.ts`、`data/rule-bindings.ts` |
| 纯规则由页面自理 | `pages/logical-models/lib/logical-model-form.ts`、`provider-model-candidates.ts`、`logical-model-writes.ts` |
| 乐观草稿与真实取数并存 | `pages/model-management/components/provider-rule-bindings.tsx` |
| 共享队列 | `lib/task-queue.ts` |
| 本机偏好的持久化 | `store/persisted-store.ts`（唯一实现）+ `store/app-ui-store.ts`、`i18n/store.ts`、`store/model-test-config.ts` |
| 页面临时数据 | `store/page-scratch.ts`（`persisted-store` 之上的薄封装）+ `pages/logs/store.ts`、`pages/request-logs/store.ts`、`pages/model-management/store.ts` |
| 纯逻辑与组件分家 | `lib/model-test/selection.ts`、`results.ts`、`config.ts` + 同名测试（从 `components/model-test-panel.tsx` 搬出） |
| 护栏本体 | `packages/console/scripts/check-console-layers.mjs`、`check-console-view-purity.mjs` + `view-logic-budget.json` |

页面清单与侧边栏分组仍以 `components/app-sidebar.tsx` 为准（见 [desktop.md](../platform/desktop.md)）；技术栈与构建见 [tech-architecture.md](./tech-architecture.md)。
