import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeProfile } from '@common/runtime-profile'
import { DEVELOPMENT_TOKEN_PATH } from '@server/management/core/development-token'
import { exportWebsiteScreenshots, resolveScreenshotCases } from './screenshot-export'
import {
  registerExternalLinkIpc,
  registerOpenDataDirectoryIpc,
  registerRuntimeConfigIpc,
  registerWindowFullScreenIpc,
  registerWindowThemeIpc,
} from './host-ipc'

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
// 凭证靠向那个开发实例要（见下方 `fetchDevelopmentToken`），这是本进程唯一需要连服务的地方。
//
// - `VITE_DEV_SERVER_URL`：渲染层地址，默认 `http://localhost:5173`。
// - `SCREENSHOT_SET`：拍哪一份编排（见 `source/screenshot-sets.ts`，如 `site` / `docs`）；
//   不传就用默认 set。
// - `SCREENSHOT_ONLY`：在选定 set 内收窄到这些 `shot.fileName`（逗号分隔，如 `06-client-config`）；
//   名字必须都在 set 里，写错即失败。
// - `SCREENSHOT_WITH`：按名字把任意 set 里的某张**追加**进来（补拍 set 之外的一页）。
// - `SCREENSHOT_OUTPUT_DIR`：产物目录。脚本会传目标目录；不传就按「应用根的上两层」推
//   （开发态即仓库根）。
const baseUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
const setName = process.env.SCREENSHOT_SET
const splitList = (value: string | undefined) => value?.split(',').map(entry => entry.trim()).filter(Boolean)
const only = splitList(process.env.SCREENSHOT_ONLY)
const with_ = splitList(process.env.SCREENSHOT_WITH)

// 先解析一遍 case。名字写错（`--set` / `--only` / `--with`）在这里就抛，落一条清楚的
// 错误再 `app.exit(1)`：否则过滤出空数组、循环一次都不跑，进程带着退出码 0 报「成功导出
// 0 张」，比直接失败更难查。
let cases: ReturnType<typeof resolveScreenshotCases>
try {
  cases = resolveScreenshotCases({ setName, only, with: with_ })
} catch (error) {
  console.error(`[screenshots] ${error instanceof Error ? error.message : String(error)}`)
  app.exit(1)
  // `app.exit` 之后不再往下走；给它一个稳定类型。
  cases = []
}

/**
 * 这个进程**没有窗口时也不许自行退出**。
 *
 * Electron 的缺省行为是「所有窗口关闭就退出应用」。`exportWebsiteScreenshots` 在收尾时
 * `destroy()` 掉截图窗口，那一瞬间窗口数归零，主进程会立刻开始退出——而淘汰过程正好发生在
 * `app.exit(0)` 之后、Electron 真正退出之前，于是退出码被那个缺省行为覆写，脚本据此报
 * 「导出失败」，其实图早就写完了。
 *
 * 主进程形态靠 `index.ts` 里同名的监听者活在托盘上；无头入口没有托盘，只能显式按住。
 */
app.on('window-all-closed', () => {
  // 有意留空：进程的句点由 `app.exit()` 显式给出。
})

// 摆好宿主 IPC 面：preload 里 `ipcRenderer.sendSync('runtime:get-config')` 没有监听者时
// **不报错、也不超时**，渲染进程就此永久阻塞——页面永远到不了可截状态，表现成「截图脚本卡住」
// （Electron 只在控制台留一行 `... without listeners`）。这里注册的是「页面能调用的宿主能力」
// 那一小面，实现与主进程共用（见 `host-ipc.ts`），免得两侧各自长一份、又各自漂移。
//
// 注册放在模块顶层、早于 `whenReady`：与 `index.ts` 同一条约束，第一个窗口创建之前必须就位。
//
// 有意**不注册**的：
//   - `screenshots:export`——无头入口本身就是那个导出的实现，不需要再暴露给页面；
//   - `updater:*`——更新卡只在设置页出现，不在截图清单里，且真去查更新会打网络；
//   - 应用级的东西（单实例锁、托盘、服务进程、数据目录）——本进程一概不碰。
//     `app.setPath('userData', ...)` 尤其不能设：与正在跑的应用共用同一个数据目录会让
//     Chromium 的 userData 单例锁撞在一起，两个 Electron 进程互相干扰。
//
// 凭证只能向**已经跑着的那个开发实例**要：本进程没有自己的管理服务，而凭证现在只活在
// 宿主的内存里（不落盘，见 `@server/management/token`），没有文件可读。开发形态为此开了
// 一条专用通道（`packages/core/source/management/core/development-token.ts`），它只对
// 非浏览器客户端应答，所以这里用 Node 的 `fetch`（不带 `Origin`）直取。
//
// 拿不到就照旧给 `null`：页面会 401，但脚本不会在第一步就死掉——那样连“到底是服务没起
// 还是凭证不对”都看不出来。
const developmentProfile = getRuntimeProfile('development')
// 路径拼在**根**上，不是 `managementApiUrl` 上：后者的结尾已经带了 `/api`，再拼一条
// 完整路径就会变成 `/api/api/...`。这个写法与 CLI 的 `formatUrl` 是同一个形状。
const DEVELOPMENT_TOKEN_ENDPOINT = `${developmentProfile.managementApiUrl.replace(/\/api$/, '')}${DEVELOPMENT_TOKEN_PATH}`

async function fetchDevelopmentToken(): Promise<string | null> {
  try {
    const response = await fetch(DEVELOPMENT_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { success?: unknown; data?: { token?: unknown } }
    if (payload.success !== true || typeof payload.data?.token !== 'string') return null
    return payload.data.token
  } catch {
    return null
  }
}

// 取凭证是异步的，而 preload 用的是 `sendSync`，所以必须在**创建窗口之前**拿到它：
// 否则第一次 `runtime:get-config` 就会回一份 null，那一整张图的 API 全部 401。
let developmentToken: string | null = null
registerRuntimeConfigIpc(developmentProfile.managementApiUrl, () => developmentToken)
registerExternalLinkIpc()
registerOpenDataDirectoryIpc()
registerWindowThemeIpc()
// 截图窗口不是主窗口（也从不会全屏），`window:get-full-screen-state` 没有一个登记的窗口时
// 回 `false`，正好就是这里的正确值——不需要 `registerWindowFullScreenEvents`。
registerWindowFullScreenIpc()

app.whenReady().then(async () => {
  const outputDirectory = process.env.SCREENSHOT_OUTPUT_DIR
    ?? path.resolve(app.getAppPath(), '..', '..', 'snapshot')

  // 先把凭证拿到手再开窗口，理由见 `developmentToken` 的注释。拿不到不是致命错误：
  // 页面会 401、图会全是空状态，但至少脚本能跑完并把「为什么是空的」说清楚。
  developmentToken = await fetchDevelopmentToken()
  if (developmentToken === null) {
    console.warn('[screenshots] could not read the development management token; API calls will return 401 — is `pnpm dev` running?')
  }

  try {
    const result = await exportWebsiteScreenshots({
      baseUrl,
      outputDirectory,
      preloadPath: path.join(__dirname, 'preload.js'),
      cases,
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
