# 设计文档与资产

本目录收纳**设计文档与视觉资产**，面向视觉与物料，不进静态站、不参与打包。

它是文档根四类内容之一（分类与布局原则见 [`../README.md`](../README.md)）：与 [`../source/`](../source/)（使用者手册）、[`../product/`](../product/README.md)（内部规格）、[`../references/`](../references/README.md)（上游快照）并列，是唯一「不服务阅读、只服务取用」的一类。

| 子目录 | 内容 |
|--------|------|
| [`brand/`](./brand/README.md) | 品牌标志的单一矢量源、导出脚本说明、各平台托盘产物的取舍。 |
| [`x-post/`](./x-post/) | 社交平台封面：`x-cover.html`（手动截图源）与导出图 `x-cover.png`。 |

## 约定

1. **标志只有一个矢量源。** 所有位图（打包 png / ico、托盘、文档导出）都由 [`brand/icon.svg`](./brand/icon.svg) 派生，改标志只改 [`packages/console/public/icon.svg`](../../../packages/console/public/icon.svg) 再跑 `pnpm icons`，不要手改 png。
2. **画布类资产不参与构建。** `x-cover.html` 靠浏览器手动截图产出，字体与截图的相对路径写死在文件里，移动文件必须同步改路径。
