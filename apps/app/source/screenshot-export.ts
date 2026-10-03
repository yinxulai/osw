import { BrowserWindow, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  buildScreenshotUrl,
  expandScreenshotSet,
  findScreenshotSet,
  findScreenshotShot,
  SCREENSHOT_SETS,
  type ScreenshotCase,
} from './screenshot-sets'

const SCREENSHOT_WIDTH = 1200
const SCREENSHOT_HEIGHT = 800
const SCREENSHOT_PIXEL_WIDTH = SCREENSHOT_WIDTH * 2
const SCREENSHOT_PIXEL_HEIGHT = SCREENSHOT_HEIGHT * 2
const CAPTURE_SETTLE_MILLISECONDS = 1800
/** 页面「真的画出来了」的等待上限；超时即失败，不拍空白页。 */
const CAPTURE_READY_TIMEOUT_MILLISECONDS = 20000
/** 探测脚本单次调用的等待上限：渲染进程主线程被同步 IPC 卡住时它永远不会返回。 */
const RENDER_PROBE_TIMEOUT_MILLISECONDS = 2000
const CAPTURE_READY_POLL_MILLISECONDS = 100
/** 图片还没加载完也允许开拍的时刻（避免一张坏图把整轮导出拖死）。 */
const CAPTURE_READY_IMAGE_GRACE_MILLISECONDS = 6000

export interface ScreenshotExportProgress {
  completed: number
  total: number
  current: string
}

export interface ScreenshotExportResult {
  count: number
  outputDirectory: string
}

export interface ScreenshotExportOptions {
  baseUrl: string
  outputDirectory: string
  preloadPath: string
  /**
   * 要拍的那几组 case。**必须显式传入**——引擎不再认「全清单」这种全局概念。
   *
   * 谁要拍什么由调用方（脚本 / 无头入口）从 `screenshot-sets.ts` 的编排里解析出来，
   * 引擎只管把这一组 case 逐个拍掉。这样多一个用途（官网、文档……）不必改引擎。
   */
  cases: readonly ScreenshotCase[]
  onProgress?: (progress: ScreenshotExportProgress) => void
}

/** 默认 set 名（不传 `--set` 时用它）。 */
export { DEFAULT_SCREENSHOT_SET, SCREENSHOT_SETS } from './screenshot-sets'
export { buildScreenshotUrl }

/** `resolveScreenshotCases` 的入参：选哪份 set、在其中收窄或补拍哪几页。 */
export interface ResolveScreenshotCasesOptions {
  setName?: string
  only?: readonly string[]
  with?: readonly string[]
}

/**
 * 解析一次导出要拍哪些 case。
 *
 * 三层叠加，与脚本侧的语义一一对应：
 *   1. 选一份 set（`setName`，缺省用 `DEFAULT_SCREENSHOT_SET`）；
 *   2. 若给了 `only`，在该 set 内只保留这些 `fileName`——名字必须都在 set 里，
 *      写错一个就抛；否则过滤出空数组、一张都不拍还报「成功导出 0 张」，比直接失败更难查。
 *   3. 若给了 `with`，按名字把**任意 set** 里的某张追加进来（`only` 是「收窄」，
 *      `with` 是「追加补拍一张」），用于临时补一张 set 之外的页面。
 *
 * 返回的 case 已按 set 的语言/主题展开，调用方直接循环即可。
 */
export function resolveScreenshotCases(options: ResolveScreenshotCasesOptions): ScreenshotCase[] {
  const setName = options.setName ?? SCREENSHOT_SETS[0].name
  const set = findScreenshotSet(setName)
  if (!set) {
    const known = SCREENSHOT_SETS.map(candidate => candidate.name).join(', ')
    throw new Error(`unknown screenshot set "${setName}"; known sets: ${known}`)
  }

  let cases = expandScreenshotSet(set)

  if (options.only && options.only.length > 0) {
    const known = new Set(cases.map(captureCase => captureCase.fileName))
    const unknown = options.only.filter(fileName => !known.has(fileName))
    if (unknown.length > 0) {
      throw new Error(
        `unknown --only value(s) in set "${set.name}": ${unknown.join(', ')}; known: ${[...known].join(', ')}`,
      )
    }
    cases = cases.filter(captureCase => options.only!.includes(captureCase.fileName))
  }

  if (options.with && options.with.length > 0) {
    const locales = set.locales ?? ['en', 'zh-CN']
    const themes = set.themes ?? ['light', 'dark']
    const additions: ScreenshotCase[] = []
    for (const fileName of options.with) {
      // 同名 shot 优先从当前 set 找，找不到再全表找——这样 `with` 也能指到别的 set 的页。
      const shot = findScreenshotShot(set, fileName)
        ?? SCREENSHOT_SETS.flatMap(candidate => candidate.shots).find(candidate => candidate.fileName === fileName)
      if (!shot) {
        const known = SCREENSHOT_SETS.flatMap(candidate => candidate.shots).map(candidate => candidate.fileName).join(', ')
        throw new Error(`unknown --with value "${fileName}"; known: ${known}`)
      }
      for (const locale of locales) {
        for (const theme of themes) {
          additions.push({ fileName: shot.fileName, route: shot.route, locale, theme, storage: shot.storage })
        }
      }
    }
    cases = [...cases, ...additions]
  }

  return cases
}

export function parseWindowId(sourceId: string): number | null {
  const match = /^window:(\d+):/u.exec(sourceId)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function runScreencapture(windowId: number, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/sbin/screencapture',
      ['-x', '-o', '-l', String(windowId), filePath],
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        const detail = stderr.trim() || error.message
        reject(new Error(`screencapture failed: ${detail}`))
      },
    )
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function normalizeCapture(filePath: string): Promise<void> {
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error(`captured image is empty: ${filePath}`)

  const { width, height } = image.getSize()
  if (width === SCREENSHOT_PIXEL_WIDTH && height === SCREENSHOT_PIXEL_HEIGHT) return

  const resized = image.resize({
    width: SCREENSHOT_PIXEL_WIDTH,
    height: SCREENSHOT_PIXEL_HEIGHT,
    quality: 'best',
  })
  await fs.writeFile(filePath, resized.toPNG())
}

async function captureWindow(target: BrowserWindow, windowId: number, filePath: string): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    target.showInactive()
    target.moveTop()
    await delay(200)

    try {
      await runScreencapture(windowId, filePath)
      return
    } catch (error) {
      lastError = error
      await delay(attempt * 500)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('screencapture failed')
}

/**
 * 写本地存储的辅助脚本。
 *
 * 导出窗口每次换页都会 `loadURL`，localStorage 是同一个 `partition`，所以这里只需在
 * 开拍前把「默认偏置」写好（引导已完成、语言英文），换页不必重写——除非某张 shot 自带
 * `storage`（例如引导页要反过来把 `onboardingComplete` 压回 `false`），那时在切到它之前
 * 单独覆盖一次。
 */
function storageScript(entries: Record<string, unknown>): string {
  const pairs = Object.entries(entries)
    .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))})`)
    .join('\n')
  return pairs
}

/** 默认偏置：主窗口已经走过引导、语言英文。主题由 `?theme=` 决定，不在这里写。 */
const DEFAULT_STORAGE: Record<string, unknown> = {
  'osw-ui': { state: { themeMode: 'system', onboardingComplete: true }, version: 0 },
  'osw-language': { state: { preference: 'en' }, version: 0 },
}

async function initializeExportWindow(target: BrowserWindow, baseUrl: string, firstCase: ScreenshotCase): Promise<void> {
  await target.loadURL(buildScreenshotUrl(baseUrl, firstCase))
  await target.webContents.executeJavaScript(storageScript(DEFAULT_STORAGE))
}

/** 渲染进程主线程被同步 IPC 卡住时的哨兵：探测调用永远不 settle。 */
const RENDERER_UNRESPONSIVE = Symbol('renderer-unresponsive')

export interface CaptureReadiness {
  hasRuntime: boolean
  rootChildren: number
  pendingImages: number
}

/**
 * 一帧样本的判定结果。
 *
 *   - `empty`：页面还没画出来（preload 没跑完，或 React 还没挂载）；
 *   - `content`：有内容了，但还有可见图片没加载完，且宽限期没过——再等等；
 *   - `ready`：可以拍了。
 *
 * 拆成三档而不是布尔：调用方需要区分「什么都没等到」（要报错）与「等到了内容但图片慢」
 * （可以先将就着拍）。合成一个布尔的话，前者就必须靠另一个变量记着，那个变量正是漏掉检查的入口。
 */
export type CaptureVerdict = 'empty' | 'content' | 'ready'

/**
 * 这一帧够不够开拍。
 *
 * 前两条缺一不可：`apiBase` 已注入说明 preload 真的跑完了（`sendSync` 拿到了宿主应答），
 * `#root` 有子节点说明 React 挂载了。原版只看 `document.fonts.ready` 加一个固定延时，
 * 渲染进程被卡住时照样一路放行，截出来一整批空白图且不报错——这两条就是那个教训的落点。
 *
 * 图片那一项可以通融：宽限期一过就先拍，一张坏图不该把整轮导出拖死。
 */
export function evaluateCapture(sample: CaptureReadiness, imagesSettled: boolean): CaptureVerdict {
  if (!sample.hasRuntime || sample.rootChildren === 0) return 'empty'
  return sample.pendingImages === 0 || imagesSettled ? 'ready' : 'content'
}

/**
 * 探一次「页面到底画出来没有」。
 *
 * 单次探测用 `Promise.race` 限时：**主线程被卡住时 `executeJavaScript` 的 promise 永远不 settle**，
 * 不设上限的话这里会取代原来那个 bug，变成另一种「卡住」。
 */
async function measureCaptureReadiness(target: BrowserWindow): Promise<CaptureReadiness> {
  // 超时那一支要显式标成哨兵类型：`delay` 是 `Promise<void>`，直接写进 `race` 会让推断结果
  // 带上 `void`，后面的哨兵比较就成了「永远为假的窄化」而不是一个真的联合分支。
  const unresponsive = delay(RENDER_PROBE_TIMEOUT_MILLISECONDS).then(
    (): typeof RENDERER_UNRESPONSIVE => RENDERER_UNRESPONSIVE,
  )

  const measured = await Promise.race([
    target.webContents.executeJavaScript(`
      (() => {
        const root = document.querySelector('#root')
        const images = Array.from(document.images).filter(image => {
          const style = getComputedStyle(image)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        return {
          hasRuntime: Boolean(window.__OSW__ && window.__OSW__.apiBase),
          rootChildren: root ? root.childElementCount : 0,
          pendingImages: images.filter(image => !(image.complete && image.naturalWidth > 0)).length,
        }
      })()
    `) as Promise<CaptureReadiness>,
    unresponsive,
  ])

  if (measured === RENDERER_UNRESPONSIVE) {
    throw new Error(
      'screenshot page is unresponsive: a synchronous IPC in preload never returned. '
      + 'The host must register `runtime:get-config` before any window is created.',
    )
  }
  return measured
}

/**
 * 等页面「真的画完了」，等到就返回，等不到就抛。
 *
 * 原版只等 `document.fonts.ready` + 两帧 rAF + 固定 1800ms，**完全不检查页面渲染没渲染**。
 * 于是渲染进程被卡住时（例如 preload 的 `sendSync` 没有监听者，主线程永久阻塞）这段代码照样
 * 一路返回，24 张图全从一个死渲染进程上抓，出来一片空白，还一句错都不报——现象就是
 * 「脚本像跑完了、截出来却什么都没有」，或者干脆卡在别处。现在改成轮询等真实内容：
 * `__OSW__` 已注入（preload 跑完了）、`#root` 有子节点（React 挂载了）、可见图片都加载完。
 *
 * 等不到就抛：宁可红着退出，也不产出一批假图。
 */
async function waitForCaptureReady(target: BrowserWindow): Promise<void> {
  const deadline = Date.now() + CAPTURE_READY_TIMEOUT_MILLISECONDS
  const imageDeadline = Date.now() + CAPTURE_READY_IMAGE_GRACE_MILLISECONDS
  let last: CaptureReadiness = { hasRuntime: false, rootChildren: 0, pendingImages: 0 }
  let observedContent = false

  while (Date.now() < deadline) {
    last = await measureCaptureReadiness(target)
    const verdict = evaluateCapture(last, Date.now() >= imageDeadline)
    if (verdict !== 'empty') observedContent = true
    if (verdict === 'ready') break
    await delay(CAPTURE_READY_POLL_MILLISECONDS)
  }

  if (!observedContent) {
    const seconds = Math.round(CAPTURE_READY_TIMEOUT_MILLISECONDS / 1000)
    throw new Error(
      `screenshot page did not render within ${seconds}s (apiBase=${last.hasRuntime}, root children=${last.rootChildren})`,
    )
  }

  // 字体与第一帧动画都落定以后再抓；上面已经确认过有内容，这里只是让取景稳定。
  await target.webContents.executeJavaScript(`
    Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    ])
  `)
  await delay(CAPTURE_SETTLE_MILLISECONDS)
}

async function clearPointerState(target: BrowserWindow): Promise<void> {
  target.webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })
  await target.webContents.executeJavaScript(`
    (() => {
      const overlayId = 'osw-screenshot-pointer-overlay'
      let overlay = document.getElementById(overlayId)
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = overlayId
        overlay.setAttribute('aria-hidden', 'true')
        Object.assign(overlay.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '2147483647',
          background: 'transparent',
          cursor: 'default',
        })
        document.body.appendChild(overlay)
      }

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })()
  `)
  await delay(100)
}

export async function exportWebsiteScreenshots(options: ScreenshotExportOptions): Promise<ScreenshotExportResult> {
  if (process.platform !== 'darwin') {
    throw new Error('Website screenshot export currently requires macOS screencapture.')
  }

  const cases = options.cases
  if (cases.length === 0) throw new Error('screenshot export received no cases to capture')

  await fs.mkdir(options.outputDirectory, { recursive: true })

  const target = new BrowserWindow({
    title: 'OSW Screenshot Export',
    width: SCREENSHOT_WIDTH,
    height: SCREENSHOT_HEIGHT,
    minWidth: SCREENSHOT_WIDTH,
    minHeight: SCREENSHOT_HEIGHT,
    maxWidth: SCREENSHOT_WIDTH,
    maxHeight: SCREENSHOT_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'osw-screenshot-export',
    },
  })

  target.setMenuBarVisibility(false)
  target.setIgnoreMouseEvents(true)
  target.setFocusable(false)
  target.setAlwaysOnTop(true, 'floating')

  try {
    await initializeExportWindow(target, options.baseUrl, cases[0])
    target.showInactive()
    await delay(300)

    const windowId = parseWindowId(target.getMediaSourceId())
    if (windowId === null) throw new Error('unable to resolve the native screenshot window id')

    let completed = 0
    for (const captureCase of cases) {
      const current = `${captureCase.locale}/${captureCase.theme}/${captureCase.fileName}.png`
      options.onProgress?.({ completed, total: cases.length, current })

      await target.loadURL(buildScreenshotUrl(options.baseUrl, captureCase))
      // 这张 shot 自带本地存储状态（如引导页）时，进页后先覆盖默认偏置，再等它真的画出来。
      if (captureCase.storage) {
        await target.webContents.executeJavaScript(storageScript(captureCase.storage))
        await target.loadURL(buildScreenshotUrl(options.baseUrl, captureCase))
      }
      await waitForCaptureReady(target)
      await target.webContents.executeJavaScript(`
        window.scrollTo(0, 0)
        for (const element of document.querySelectorAll('*')) {
          if (element.scrollTop > 0) element.scrollTop = 0
        }
      `)
      await clearPointerState(target)

      const outputPath = path.join(options.outputDirectory, captureCase.locale, captureCase.theme, `${captureCase.fileName}.png`)
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await captureWindow(target, windowId, outputPath)
      await normalizeCapture(outputPath)

      completed += 1
      options.onProgress?.({ completed, total: cases.length, current })
    }

    return {
      count: completed,
      outputDirectory: options.outputDirectory,
    }
  } finally {
    if (!target.isDestroyed()) target.destroy()
  }
}
