# 流程编排 v2（Dify 风格原型）

## 定位
- v2 是面向讨论的可视化编排原型，强调画布体验而非后端接入。
- 保留 v1 代码用于对比，菜单入口已切换到 v2。

## 与 v1 的主要差异
- 结构从线性列表升级为“左侧节点库 + 中央画布 + 右侧属性面板”。
- 节点关系从隐式顺序升级为显式 `next / nextTrue / nextFalse` 连线。
- 条件节点支持 true / false 双分支，接近 Dify 的分流体验。
- 引入 start / end 节点，流程边界更明确。

## 当前能力
- 节点类型：start、condition、modifier、transformer、route-queue、end。
- 画布：自动根据 next 关系渲染连线与标签。
- 右侧配置：编辑名称、开关、字段、分支指向、队列目标等。
- 本地试跑：输入 JSON，执行节点图，输出轨迹与结果。
- 终止机制：end、missing-next、max-steps、error。

## 关键文件
- 页面：source/render/source/pages/workflow-orchestrator-v2/page.tsx
- 引擎：source/render/source/pages/workflow-orchestrator-v2/engine.ts
- 类型：source/render/source/pages/workflow-orchestrator-v2/types.ts
- 示例：source/render/source/pages/workflow-orchestrator-v2/fixtures.ts

## 已知限制（故意保留）
- 还不支持拖动画布中的节点位置（位置是静态字段）。
- 还不支持在画布上拖拽拉线创建连接（通过右侧下拉选择 next）。
- 没有持久化和版本管理，仅用于原型讨论。

## 下一步建议（v2.1）
- 节点位置拖拽 + 自动吸附网格。
- 从节点出发拖线创建连接，并支持删除连线。
- 节点配置校验（路径为空、next 缺失、循环检测）和错误高亮。
- 保存/导入/导出编排 JSON，支持版本回放。
