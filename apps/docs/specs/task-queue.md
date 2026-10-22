# 通用任务队列

## 1. 文档状态与边界

本文定义**服务端进程级任务队列**的契约：一个「一批要真跑、有进度、能取消、结果要能边跑边看」的功能怎么排队、怎么取消、怎么把状态送到界面上。

已实现：引擎 `packages/core/source/management/tasks/queue.ts`、进程级单例与 kind 注册 `packages/core/source/management/tasks/index.ts`、推送通道 `packages/core/source/management/infrastructure/task-stream.ts`、五条管理接口 `packages/core/source/management/routes/tasks.ts`、线上契约 `packages/contracts/source/tasks.ts`、客户端订阅 `packages/console/source/data/tasks.tsx`。

**渠道诊断是第一个 kind，不是它的定义。** 队列本身只懂生命周期，一个业务字段都不认识。诊断那部分的口径（请求怎么写、多轮怎么汇总、什么算通过）在 [diagnostics.md](./diagnostics.md)。

本文不覆盖：诊断的探测细节（[diagnostics.md](./diagnostics.md)）；推送通道的传输骨架与背压（`packages/core/source/realtime/stream-fanout.ts` 的文件头，与「进行中的请求」共用同一份）；管理 API 的守卫与错误边界（[server-architecture.md](./server-architecture.md)）。

## 2. 为什么是通用的

渠道诊断暴露出来的是四件事：**入队、进度、取消、结果**。它们不是诊断特有的——以后任何「批量跑真东西」的功能（批量导出、批量拉模型清单、批量重建索引）都是同一个形状。写成诊断专用，下一个功能就得把同一套调度再写一遍，然后两份实现慢慢漂移。

所以分工是：

| 谁 | 懂什么 |
|---|---|
| 引擎（`queue.ts`） | 生命周期：`queued → running → success \| failed \| cancelled`；并发、去重、取消、上限、通知 |
| kind（`tasks/kinds/*.ts`） | 业务语义：载荷怎么解析、去重键是什么、怎么跑、进度与结论长什么样 |
| 路由（`routes/tasks.ts`） | HTTP 适配：校验入参、把载荷原样交给队列、把结果写回响应 |
| 推送（`task-stream.ts`） | 把台账变成一帧帧全量快照 |

`progress` / `result` 对引擎是**不透明**的：它只负责携带与推送，不读、不改、不解释。因此 `queue.ts` 里不可能出现「诊断」「模型」「渠道」这些词。

## 3. 契约

### 3.1 `TaskRecord`

```ts
interface TaskRecord {
  id: string
  kind: string
  key: string          // 该 kind 的 keyOf 输出，队列记录
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  progress?: unknown   // kind 自己的形状
  result?: unknown
  errorMessage?: string
  enqueuedAt: number
  finishedAt?: number
}
```

`key` 是队列自己的身份概念，有两个用处：去重（同 kind 同 key 在排队 / 运行中不重复入队），以及**让客户端把一帧里的任务对回本地视图**——一条还在排队、没有任何 `progress` 的任务，只有靠它才说得清「这是哪个目标」。

### 3.2 `TaskKind`

```ts
interface TaskKind<P, R, G> {
  kind: string
  concurrency?: number          // 同 kind 同时在飞上限，默认 1
  parse(input: unknown): P      // HTTP 载荷是 unknown，解析不过就抛
  keyOf(payload: P): string
  run(payload: P, context: { taskId: string; signal: AbortSignal; report(progress: G): void }): Promise<R>
}
```

**`parse` 是必须的，不是可选的美化。** 载荷来自 HTTP，运行时是一团 `unknown`；没有它就只能靠类型断言把界面的错误输入直接喂给 kind。解析失败的那一项会被算作 `skipped`，而不是把整个批次带下水。

### 3.3 状态转移

```
queued ──pump──▶ running ──run 成功──▶ success
   │               │
   │               ├──run 抛错──▶ failed
   │               │
   └─cancel（未开跑）└─signal 生效后 run 收尾──▶ cancelled
        └──▶ cancelled
```

`cancelled` 是**独立结局**，不是一种失败：它没有结论，不该进失败率。

## 4. 调度

### 4.1 并发：每 kind 一个上限，默认 1

引擎按「谁先空出来谁取下一个」发放任务（`TaskQueue.pump`），所以同一时刻在飞的数量**真的等于** `concurrency`，不是「分片大小」——按固定分片跑时，整批的节奏由最慢的那一片决定。

默认是 **1（串行）**，因为诊断量的是**延迟与首字**：同时打多个上游会互相污染读数（连接复用、出口带宽、上游侧排队）。串行是诚实的默认——一个数只有一次请求在飞时才说得清是谁的。需要更快就由 kind 显式调大，并接受读数被稀释的代价。

`concurrency` 写成 0 或负数时按 1 处理：配置写错不该把队列卡死。

### 4.2 去重

同 kind 同 `keyOf` 已在 `queued` / `running` 时不重复入队。防的是连点两下造成**两倍计费**——这是一笔真的会发生的钱。

任务结束之后同 key 可以再入队，那就是「重测」。

### 4.3 上限

`MAX_QUEUE_TASKS = 500`。它是**内存上界**，不是调度策略：终态项也要靠 `clear` 才回收，所以上限管的是「这个进程最多替多少条任务记账」。到顶之后新的入队被拒（返回 `skipped`），而不是把旧任务挤掉——旧任务有结论，挤掉它等于把用户刚看到的东西抹了。

### 4.4 `clear`

清掉终态项。**有任务在跑时整条空操作**：那会让「进行中」的行凭空消失，而用户还没来得及看它跑完。

### 4.5 不落盘

纯内存，重启即空。「此刻有什么在跑」没有恢复语义，假装能恢复只会制造「重启后任务少了一半」这种无法归因的现象。

## 5. HTTP

五条 `POST`，全在 `/api/tasks/*` 下：

| 路由 | 请求体 | 响应 |
|---|---|---|
| `POST /api/tasks/enqueue` | `{ kind, items }` | `{ accepted, skipped }` |
| `POST /api/tasks/snapshot` | — | `{ tasks }` |
| `POST /api/tasks/stream` | — | 分块 NDJSON（见 §6） |
| `POST /api/tasks/cancel` | `{ taskIds?, kind? }` | `{ cancelled }` |
| `POST /api/tasks/clear` | — | `{ cleared }` |

**守卫 / CORS / 路由匹配一处都没改。** `http-router.ts` 是精确路径匹配（不支持 `:id`），`request-guards.ts` 有意只收 `POST`——在「不签发任何调用方凭证」的前提下的刻意姿态。五条接口都是这个形状，所以它们只是又一个普通管理 API。

`skipped` 包含五种「没收下」，全部是**正常的调度结果**，不是请求失败：这个 `kind` 没注册、这一项不能被该 kind 解析（`parse` 抛了）、这一项算不出键（`keyOf` 抛了）、同键已在排队 / 运行中（去重）、队列已满（`MAX_QUEUE_TASKS`）。一次「全选 → 开始」里本来就可能有一半已经在跑，界面要如实报出这两个数，而不是静默吞掉。

## 6. 推送

一条长响应，每帧一行版本化消息（NDJSON）：

```json
{"protocolVersion":1,"type":"snapshot","tasks":[…]}
{"protocolVersion":1,"type":"heartbeat"}
```

- **首帧必是快照**，新连上来的客户端不必等一个节拍。
- **变更即推全量快照**，不做增量：队列有总量上界，重发完整的代价有界，却天然解决乱序、丢帧、慢客户端与重连对齐。
- **空闲时推心跳**（10 秒）。这条流**不结束**——队列是进程级台账，没有「推完了」这个时刻，心跳是连接还活着的唯一证据。
- 传输复用「进行中的请求」那套 `createFanout`：同一份背压（只保留最新一帧，`drain` 时补最新）、同样的订阅者生命周期、同样的定时器 `unref()`。

## 7. 客户端

### 7.1 `TasksProvider`

`packages/console/source/data/tasks.tsx`，与 `data/live-requests.tsx`、`data/live-metrics.tsx` 并列同风格：订阅 `/api/tasks/stream`，暴露 `tasks / enqueue / cancel / clear`。

它**不持有任何调度状态**：队列在服务端跑，这一层只负责订阅与转发命令。断线重连交给三条流共用的 `useResilientStream`（重连期间保留上一帧，直到新快照到达）。

### 7.2 为什么面板必须挂在外壳上

`ModelTestPanel` 挂在 `App.tsx`（与 `RouteModeDialog` 并列），`open` / `minimized` 进 `app-ui-store`。

归页面时，导航走了就等于卸载组件 = 客户端队列一卸载就把在飞的请求全掐掉——「边看日志边等结果」因此做不到。队列搬到服务端之后，界面卸载只是不看了：**卸载不发任何取消命令**，任务照跑，回来还在。

### 7.3 非模态与最小化

- **非模态**：没有遮罩，`fixed` 浮窗，页面照旧可交互、可滚动。
- **最小化 = 角标**：`第 N/M 轮` + `已完成/总数` + 失败计数（红点）+ 展开 / 取消。失败数必须主动说出来——边看日志时，你唯一想被主动告知的就是「有几个挂了」。
- **最小化 ≠ 关闭**：跑的时候允许收起；关闭要确认，确认即取消这一批。

## 8. 新增一个 kind

1. 在契约层写载荷 schema 与 `progress` / `result` 的形状（按 kind 分文件，不塞进 `tasks.ts`）。
2. 在 `tasks/kinds/<name>.ts` 实现 `TaskKind`：`parse` 严格校验、`keyOf` 给出稳定去重键、`run` 在**每一步开始前**检查 `signal.aborted`。
3. 在 `tasks/index.ts` 注册。注册是加载即完成的，不存在「先入队再注册」的竞态。
4. 客户端按 `kind` 收窄 `progress` / `result`（形状不对就当没有），不要在通用层加业务字段。

**kind 不要自己实现排队。** 并发、去重、取消、上限已经在引擎里；在 `run` 里再包一层 `Promise.all` 会让「同时在飞几个」有两个答案。

## 9. 测试策略

| 文件 | 钉住什么 |
|---|---|
| `tasks/queue.test.ts` | 状态机、去重、并发真的等于 `concurrency`（含槽位补位）、取消（未开跑零上游请求 / 在跑等步边界）、`clear` 在跑时空操作、超限拒绝、多 kind 互不干扰、订阅通知与隔离 |
| `tasks/kinds/model-test.test.ts` | 载荷解析与默认值、去重键、空目录时的「没有可测目标」 |
| `tasks/task-stream.test.ts` | 首帧是快照、变更合流成一帧、空闲心跳（假时钟）、退订后不再写 |
| `tasks-http.test.ts` | **真连接**：同一条连接持续推快照、客户端断开后队列继续跑到结局、按 id / kind 取消、`clear` 与畸形载荷 |
| `tasks-route.test.ts` | 入参校验：不合契约的请求在查询前被拒，且一个字节都不写 |
| `data/tasks.test.tsx` | 订阅、快照替换、心跳、重连保留上一帧、命令转发 |
| `components/model-test-panel.test.tsx` | 面板渲染与交互、角标文案（含失败计数）、**卸载不中断在跑的任务**、关闭前的确认 |

## 10. 验收

- 队列引擎里不出现任何业务词；kind 里不出现任何调度逻辑。
- 同一时刻在飞的任务数等于 `concurrency`，不是「分片大小」。
- 未开跑的任务被取消时，上游请求数为零。
- 在跑的任务被取消时，结局是 `cancelled`，不是 `failed`，不发遥测。
- 有任务在跑时 `clear` 返回 0，台账一条不少。
- 队列总长到上限后新入队被拒，旧任务不被挤掉。
- 推送流首帧是快照、变更即推、空闲有心跳、从不主动结束。
- 客户端断开之后队列继续跑；界面卸载/切页不发取消。
- 关闭面板时才取消；最小化不取消。
