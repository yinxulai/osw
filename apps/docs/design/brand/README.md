# 品牌资源

所有位图（打包 png / ico、托盘、文档导出）都由 **一个矢量源** 派生，不要手改 png。

```powershell
pnpm icons
```

脚本：`apps/app/scripts/generate-icons.mjs`（依赖 `@osw/app` 的 `sharp` devDependency）。

## 单一矢量源

| 文件 | 角色 |
| --- | --- |
| `packages/console/public/icon.svg` | **官方标志（唯一真源）**。一道连续斜切的闪电，彩虹渐变。同时是控制台 favicon 与侧栏标记。 |
| `docs/design/brand/icon.svg` | 上者的副本，仅供本目录自解释 / 外部取用；脚本每次运行都会重写。 |
| `docs/design/brand/icon-alt-blades.svg` | **保留的延续版本**（双刃 · 冷色霓虹）。不是标志，只作视觉延续与备选用途。 |

## 导出方式

脚本先以 512² 渲染一次源矢量、扫描 alpha > 12 的像素求出 **墨迹框**（当前 `174 × 225` 用户空间单位），
再把这个墨迹框按各用途的边距比例 contain-fit 进去。因此：

- 每个尺寸的 **视觉留白一致**，不会出现「大图标贴边、小图标缩在中间」；
- 先按 `4 ×` 放大构图、再用 `lanczos3` 降采样，16px 下边缘仍然干净。

## 产物与用途

### `apps/app/build/`（打包 / 运行时，被 Electron 直接引用）

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `icon.png` | 1024² | `electron-builder` 应用图标（Windows / Linux）；`apps/app/source/index.ts` 的窗口图标 |
| `icon-mac.png` | 1024² | macOS 应用图标（`mac.icon`） |
| `icon.ico` | 7 档 16/24/32/48/64/128/256 | Windows 可执行文件 / 安装包图标 |
| `tray-icon.png` | 16² 纯白蒙版 | 生产托盘图标（基准档，倍率 1.0） |
| `tray-icon@2x.png` | 32² 纯白蒙版 | 生产托盘图标（倍率 2.0） |
| `tray-icon@3x.png` | 48² 纯白蒙版 | 生产托盘图标（倍率 3.0） |
| `tray-icon-dev*.png` | 同上 | 开发版托盘图标，标志右下角加一颗圆点以便并排区分 |
| `tray-icon-win.png` | 48² 纯白蒙版 | **Windows 专用**，替代上面三档 |
| `tray-icon-dev-win.png` | 48² 纯白蒙版 | Windows 专用 · 开发版（右下角圆点） |

### 为什么托盘有两套产物

托盘是唯一「必定会被系统按屏幕 DPI 重新取样」的地方，所以要比别处多给一点信息——但
**两个平台要的信息不一样**，不能只发一套：

- **macOS / Linux**：走真正的多倍率。`source/tray-icon.ts` 把 16²/32²/48² 三张图
  `addRepresentation({ scaleFactor: 1|2|3 })` 拼成一个 `NativeImage`，由系统按显示倍率挑。
- **Windows**：多倍率是假的。Electron 的 `Tray::SetImage` 在 Windows 上调用
  `NativeImage::GetHICON(GetSystemMetrics(SM_CXSMICON))`，而**非 `.ico` 来源**的
  `GetHICON` 会丢弃 `size` 参数，直接
  `IconUtil::CreateHICONFromSkBitmap(image().AsBitmap())`——`AsBitmap()` 取的正是
  1× 那一档。挂上去的 2×/3× 在 Windows 上永远读不到，系统只会拿到 16² 再放大到
  24/32px，于是糊。所以 Windows 单独吃一张 48² 的大图当「1×」，让 HICON 自带像素、由系统自己缩小。

> 运行时**禁止**再调用 `image.resize()`：它只会把某一个倍率重新取样一次，正好是要避免的糊。

### 开发版托盘标记

开发版与正式版同时驻留托盘时，靠**标志右下角的一颗圆点**区分（`composeSvg` 的 `badge` 选项，
构图区约在 0.86 处）。此前用的是「切掉一角」的缺口方案，但 16px 下缺口会和闪电缺口糊在一起、
像一坨没画完的图形；改为保标志完整、另加圆点后，两个尺寸下都能一眼分清。

### `docs/design/brand/png/`（文档 / 物料导出，不参与打包）

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `icon-1024/512/256/128/64/32.png` | 各档 | 通用位图，README、官网、商店页 |
| `icon-mono-white-1024.png` | 1024² | 单色白（深色底上的反白用法） |
| `icon-mono-black-1024.png` | 1024² | 单色黑（浅色底、印刷） |
| `icon-on-dark-1024.png` | 1024² | 深色底板版本 |
| `icon-alt-blades-1024/512.png` | 1024² / 512² | 双刃延续版 |
| `social-preview.png` | 1280×640 | 社交 / 仓库预览图 |

## 边距常量

在 `generate-icons.mjs` 顶部：

```js
const APP_MARGIN   = 0.06;  // 应用图标
const TRAY_MARGIN  = 0.02;  // 托盘（16px 要尽量吃满）
const BRAND_MARGIN = 0.08;  // 文档导出
const SUPERSAMPLE  = 4;     // 构图超采样倍数
```
