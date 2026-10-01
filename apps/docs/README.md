# 文档索引

`apps/docs/` 是仓库的**文档根**，按去向分三类，**彼此不互相复制**：

| 目录 | 类别 | 面向 | 去向 |
|------|------|------|------|
| [`source/`](./source/) | 开放文档 | 使用者 | 由 Clarify 构建成静态站发布，`pnpm --filter @osw/docs dev\|build` |
| [`product/`](./product/README.md) + [`references/`](./references/README.md) | 非开放文档 | 维护者 | 仓库内部，只服务实现与评审，不进静态站 |
| [`design/`](./design/README.md) | 设计文档与资产 | 视觉 / 物料 | 仓库内部，不参与构建与打包 |

- **开放文档**：讲「怎么用」，只写在 `source/`，站点结构见 [`clarify.ts`](./clarify.ts)。
- **非开放文档**：[`product/`](./product/README.md) 写本仓库自己的设计结论（产品规格、行为契约、验收标准），回答「我们决定怎么做」；[`references/`](./references/README.md) 是上游厂商公开 API 文档的逐字快照，只回答「上游到底怎么定义的」。
- **设计文档**：品牌标志的单一矢量源与导出规则见 [`design/brand/README.md`](./design/brand/README.md)，社交封面见 [`design/x-post/`](./design/x-post/)。

同一件事只在一处展开：跨类提到同一主题时只写一句结论加链接；非开放文档内部每个主题也只保留一个权威文档（见 [`product/README.md`](./product/README.md) 的文档地图）。
