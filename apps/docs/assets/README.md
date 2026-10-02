# 设计资产

本目录（`assets/`）收纳**设计文档与视觉资产**，面向视觉与物料，不进静态站、不参与打包。

它是文档根四类内容之一（分类与布局原则见 [`../README.md`](../README.md)）：与 [`../source/`](../source/)（使用者手册）、[`../specs/`](../specs/README.md)（内部规格）、[`../upstream/`](../upstream/README.md)（上游快照）并列，是唯一「不服务阅读、只服务取用」的一类。

| 子目录 | 内容 |
|--------|------|
| [`brand/`](./brand/README.md) | 品牌标志的单一矢量源、导出脚本说明、各平台托盘产物的取舍。 |
| [`x-post/`](./x-post/) | 社交平台封面：`x-cover.html`（画布源）与导出图 `x-cover.png`（根 README 顶部 hero 图）。 |

## 约定

1. **标志只有一个矢量源。** 所有位图（打包 png / ico、托盘、文档导出）都由 [`brand/icon.svg`](./brand/icon.svg) 派生，改标志只改 [`packages/console/public/icon.svg`](../../../packages/console/public/icon.svg) 再跑 `pnpm icons`，不要手改 png。
2. **画布类资产不参与构建。** `x-cover.html` 靠浏览器渲染产出，字体与截图的相对路径写死在文件里，移动文件必须同步改路径。改完用无头 Chrome 重拍（固定 1600×900，`.stage` 填满视口）：

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
     --force-device-scale-factor=1 --allow-file-access-from-files \
     --virtual-time-budget=8000 --window-size=1600,900 \
     --screenshot=apps/docs/assets/x-post/x-cover.png \
     "file://$PWD/apps/docs/assets/x-post/x-cover.html"
   ```

   左栏文字/图标与 `snapshot/` 里的应用截图是两件事：左栏只有 HTML 改动才会变，右侧大图跟着 `snapshot/en/dark/01-logical-models.png` 一起变 —— 重拍 snapshot 后这张封面要一并重出。
