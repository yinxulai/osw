import { BrowserWindow, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const SCREENSHOT_WIDTH = 1200
const SCREENSHOT_HEIGHT = 800
const SCREENSHOT_PIXEL_WIDTH = SCREENSHOT_WIDTH * 2
const SCREENSHOT_PIXEL_HEIGHT = SCREENSHOT_HEIGHT * 2
const CAPTURE_SETTLE_MILLISECONDS = 1800

type ScreenshotLocale = 'en' | 'zh-CN'
type ScreenshotTheme = 'light' | 'dark'

export interface ScreenshotExportCase {
  fileName: string
  route: string
  locale: ScreenshotLocale
  theme: ScreenshotTheme
}

export interface ScreenshotExportProgress {
  completed: number
  total: number
  current: string
}

export interface ScreenshotExportResult {
  count: number
  outputDirectory: string
}

interface ScreenshotExportOptions {
  baseUrl: string
  outputDirectory: string
  preloadPath: string
  /** 只拍这几张（`ScreenshotExportCase.fileName`）；不传就拍全清单。用于补拍单页。 */
  only?: readonly string[]
  onProgress?: (progress: ScreenshotExportProgress) => void
}

const SHOTS = [
  { fileName: '01-logical-models', route: '/logical-models' },
  { fileName: '02-smart-routing', route: '/router' },
  { fileName: '03-request-logs', route: '/request-logs' },
  { fileName: '04-analytics', route: '/overview?range=7d' },
  { fileName: '05-request-rewrite', route: '/request-rewrite-rules' },
  { fileName: '06-client-config', route: '/client-config' },
] as const

const LOCALES: ScreenshotLocale[] = ['en', 'zh-CN']
const THEMES: ScreenshotTheme[] = ['light', 'dark']

export const SCREENSHOT_EXPORT_CASES: ScreenshotExportCase[] = LOCALES.flatMap(locale =>
  THEMES.flatMap(theme =>
    SHOTS.map(shot => ({
      fileName: shot.fileName,
      route: shot.route,
      locale,
      theme,
    })),
  ),
)

export function screenshotUrl(baseUrl: string, captureCase: ScreenshotExportCase): string {
  const url = new URL(baseUrl)
  const search = new URLSearchParams({
    lang: captureCase.locale,
    theme: captureCase.theme,
  })
  url.hash = `${captureCase.route}?${search.toString()}`
  return url.toString()
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

async function initializeExportWindow(target: BrowserWindow, baseUrl: string): Promise<void> {
  await target.loadURL(screenshotUrl(baseUrl, SCREENSHOT_EXPORT_CASES[0]))
  await target.webContents.executeJavaScript(`
    localStorage.setItem('osw-ui', JSON.stringify({
      state: {
        themeMode: 'system',
        onboardingComplete: true,
      },
      version: 0,
    }))
    localStorage.setItem('osw-language', JSON.stringify({
      state: { preference: 'en' },
      version: 0,
    }))
  `)
}

async function waitForCaptureReady(target: BrowserWindow): Promise<void> {
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
    await initializeExportWindow(target, options.baseUrl)
    target.showInactive()
    await delay(300)

    const windowId = parseWindowId(target.getMediaSourceId())
    if (windowId === null) throw new Error('unable to resolve the native screenshot window id')

    // `only` 只影响「拍哪些」，进度总数跟着缩小，两条入口（全量导出 / 补拍单页）共用同一段循环。
    const cases = options.only
      ? SCREENSHOT_EXPORT_CASES.filter(captureCase => options.only!.includes(captureCase.fileName))
      : SCREENSHOT_EXPORT_CASES

    let completed = 0
    for (const captureCase of cases) {
      const current = `${captureCase.locale}/${captureCase.theme}/${captureCase.fileName}.png`
      options.onProgress?.({ completed, total: cases.length, current })

      await target.loadURL(screenshotUrl(options.baseUrl, captureCase))
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
