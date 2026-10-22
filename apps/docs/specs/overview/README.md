# overview/

系统总览与架构：分成哪些包、服务怎么起、控制台怎么分层、进程级的任务队列怎么跑。

各文档的覆盖范围与权威归属见 [`../README.md`](../README.md) 的文档地图。

- [architecture.md](./architecture.md) — 概念定义、协议识别与转换总原则
- [tech-architecture.md](./tech-architecture.md) — 技术栈、构建打包、仓库顶层结构
- [server-architecture.md](./server-architecture.md) — 两个监听服务、模块划分、依赖方向
- [console-architecture.md](./console-architecture.md) — 控制台五层职责与 React 分工
- [task-queue.md](./task-queue.md) — 进程级通用任务队列的生命周期、kind 分工、调度与推送
