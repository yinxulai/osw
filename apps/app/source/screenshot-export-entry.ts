import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportWebsiteScreenshots } from './screenshot-export'

// 产物是 ESM，`__dirname` 在 ESM 里不存在，得从 `import.meta.url` 反推
// （与 `source/index.ts` 同一写法：产物平铺在 `output/command`，所以这里就是 preload 所在处）。
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 无头补拍入口。
//
// 正式的「一键重拍」在开发版设置页里（走 IPC），但它必须先手动打开应用、切到设置页、再点按钮，
// 而且只存在于**正在运行的那个 Electron 会话**里——想从命令行补一张新页面的截图时够不着。
// 这个入口把同一段 `exportWebsiteScreenshots` 单独编一份、以独立 Electron 进程跑一次就退出，
// 于是「重拍」变成一条脚本命令（`pnpm screenshots`），CI / 本地都能用。
//
// 它不启动服务进程、不开主窗口、不碰数据目录：只开一个受控截图窗口去加载渲染层 dev server，
// 页面照常从已经跑着的管理服务取数据。因此前提是 `pnpm dev`（或至少控制台 dev server）已经在跑。
//
// - `VITE_DEV_SERVER_URL`：渲染层地址，默认 `http://localhost:5173`。
// - `SCREENSHOT_ONLY`：收 `ScreenshotExportCase.fileName`（逗号分隔，如 `06-client-config`）；
//   不传就拍全清单。补拍一张新页面时只传它，既省事也避免顺带把其它页面重拍成不同取景。
// - `SCREENSHOT_OUTPUT_DIR`：产物目录。脚本会传仓库根的 `snapshot/`；不传就按
//   「应用根的上两层」推（开发态即仓库根，与设置页那条路一致）。
const baseUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
const only = process.env.SCREENSHOT_ONLY?.split(',').map(entry => entry.trim()).filter(Boolean)

app.whenReady().then(async () => {
  const outputDirectory = process.env.SCREENSHOT_OUTPUT_DIR
    ?? path.resolve(app.getAppPath(), '..', '..', 'snapshot')

  try {
    const result = await exportWebsiteScreenshots({
      baseUrl,
      outputDirectory,
      preloadPath: path.join(__dirname, 'preload.js'),
      only,
      onProgress: progress => {
        console.info(`[screenshots] ${progress.completed}/${progress.total} ${progress.current}`)
      },
    })
    console.info(`[screenshots] exported ${result.count} image(s) to ${result.outputDirectory}`)
    app.exit(0)
  } catch (error) {
    console.error(`[screenshots] failed: ${error instanceof Error ? error.message : String(error)}`)
    app.exit(1)
  }
})
