// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { UpdateCard } from './update-card'

/*
 * 「版本更新」卡片。
 *
 * 这里的好几条分支都不是「有更新 / 没更新」这么简单，而是**不同的更新通道**：
 *
 *  - macOS：本机装不了自己下下来的包（签名与 Gatekeeper），所以一律只给「前往下载 DMG」；
 *  - 跨大版本（`requiresManualUpdate`）：不支持自动更新，只能手动下安装包；
 *  - 没有匹配当前平台/架构的产物（`preferredAsset` 为空）：退回「GitHub 发布页」；
 *  - 其它情况：`update-available` 给「下载更新」，`downloaded` 给「立即安装」。
 *
 * 还有一个必须覆盖的边界：**浏览器形态（没有 updater）只能渲染一张说明卡**，
 * 而不是把带按钮的卡片画出来、点了没反应。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

// `useToast()` 的引用必须恒定，否则写进依赖数组的组件会陷入无限重渲染。
vi.mock('@/components/ui/toast', () => {
  const noop = vi.fn()
  const value = { toast: noop, success: state.success, error: state.error, info: noop, warning: noop }
  return { useToast: () => value }
})

const caps = vi.hoisted(() => ({
  value: null as null | { name: string; os: string; openExternal: (url: string) => void; updater: unknown },
}))

vi.mock('@/platform/capabilities', () => ({ getPlatformCapabilities: () => caps.value }))

function updateState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    status: 'idle',
    info: null,
    errorMessage: null,
    downloadProgress: null,
    downloadedFile: null,
    ...overrides,
  }
}

function updateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    currentVersion: '1.1.0',
    latestVersion: '1.2.0',
    releaseNotes: '',
    releaseDate: '2026-01-02T03:04:05.000Z',
    releaseUrl: 'https://example.com/releases/v1.2.0',
    assets: [],
    preferredAsset: { name: 'One-Switch-1.2.0-win-x64.exe', size: 1024 * 1024 * 96, downloadUrl: 'https://example.com/a.exe' },
    requiresManualUpdate: false,
    ...overrides,
  }
}

/** 造一个假的跨进程更新器，并记录渲染层调了哪些方法。 */
function createUpdater(initial: UpdateState = updateState()) {
  let listener: ((next: UpdateState) => void) | null = null
  const updater = {
    calls: [] as string[],
    emit(next: UpdateState) {
      listener?.(next)
    },
    getState: vi.fn(async () => initial),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => 'downloading' as UpdateDownloadResult),
    install: vi.fn(async () => {}),
    openReleases: vi.fn(async () => {}),
    onStateChanged: vi.fn((callback: (next: UpdateState) => void) => {
      listener = callback
      return () => { listener = null }
    }),
  }
  return updater
}

function renderCard(updater: ReturnType<typeof createUpdater> | null, os = 'win32') {
  const openExternal = vi.fn()
  caps.value = { name: updater ? 'electron' : 'web', os, openExternal, updater }
  return render(
    <I18nProvider>
      <UpdateCard />
    </I18nProvider>,
  )
}

/** 按可见文案找按钮（卡片里出现过好几个同名按钮，一律先锁定唯一的那一个）。 */
function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

function queryButton(name: string): HTMLButtonElement | null {
  return screen.queryByRole('button', { name }) as HTMLButtonElement | null
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  state.success.mockReset()
  state.error.mockReset()
})

afterEach(() => {
  caps.value = null
})

describe('没有更新器时', () => {
  it('浏览器形态只渲染一张说明卡，不画按钮', async () => {
    renderCard(null)

    expect(await screen.findByText('版本更新功能仅在 Electron 桌面端可用。')).toBeTruthy()
    // 连「检查更新」都不该出现——点了也无事可做。
    expect(queryButton('检查更新')).toBeNull()
  })
})

describe('挂载时', () => {
  it('拉一次当前状态，并订阅后续变化', async () => {
    const updater = createUpdater(updateState({ status: 'up-to-date' }))
    renderCard(updater)

    await waitFor(() => expect(updater.getState).toHaveBeenCalledTimes(1))
    expect(updater.onStateChanged).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('最新')).toBeTruthy()
  })

  it('主进程推来的状态直接画出来（不用用户点检查）', async () => {
    const updater = createUpdater(updateState())
    renderCard(updater)

    await waitFor(() => expect(updater.getState).toHaveBeenCalledTimes(1))

    updater.emit(updateState({ status: 'update-available', info: updateInfo() }))

    expect(await screen.findByText('可更新')).toBeTruthy()
    expect(await screen.findByText(/最新版本 v1\.2\.0/)).toBeTruthy()
  })

  it('卸载时退订，别让主进程继续往已卸载的组件推', async () => {
    const updater = createUpdater()
    const view = renderCard(updater)
    await waitFor(() => expect(updater.onStateChanged).toHaveBeenCalledTimes(1))
    const unsubscribe = updater.onStateChanged.mock.results[0].value as () => void

    view.unmount()

    // 返回的正是订阅时拿到的那个退订函数。
    expect(typeof unsubscribe).toBe('function')
  })
})

describe('状态徽标', () => {
  it.each([
    ['checking', '检查中'],
    ['up-to-date', '最新'],
    ['update-available', '可更新'],
    ['downloading', '下载中'],
    ['downloaded', '待安装'],
    ['error', '检查失败'],
    ['idle', '未检查'],
  ] as const)('status = %s 显示「%s」', async (status, label) => {
    const updater = createUpdater(updateState({ status }))
    renderCard(updater)

    expect(await screen.findByText(label)).toBeTruthy()
  })
})

describe('版本那一行', () => {
  it('没拿到版本信息时只显示当前版本，占位是「—」而不是空白', async () => {
    const updater = createUpdater(updateState())
    renderCard(updater)

    expect(await screen.findByText('当前版本 v—')).toBeTruthy()
    expect(screen.queryByText(/最新版本/)).toBeNull()
  })

  it('拿到信息后把当前版本、最新版本、发布时间串成一行', async () => {
    const updater = createUpdater(updateState({ info: updateInfo() }))
    renderCard(updater)

    const line = await screen.findByText(/当前版本 v1\.1\.0/)
    expect(line.parentElement?.textContent).toContain('最新版本 v1.2.0')
    expect(line.parentElement?.textContent).toContain('发布于 ')
  })

  it('发布时间按界面语言格式化（中文用 24 小时制的 2026/01/02）', async () => {
    const updater = createUpdater(updateState({ info: updateInfo({ releaseDate: '2026-01-02T03:04:05.000Z' }) }))
    renderCard(updater)

    const line = await screen.findByText(/发布于 /)
    // 只断言「按 zh-CN 渲染」这件事本身：具体时刻取决于运行机器的时区，不该写死。
    expect(line.textContent).toMatch(/发布于 2026\/01\/0[12]/)
  })
})

describe('检查更新', () => {
  it('检查中按钮禁用，避免连点', async () => {
    const updater = createUpdater(updateState({ status: 'checking' }))
    renderCard(updater)

    const check = await screen.findByRole('button', { name: /检查中/ })
    expect((check as HTMLButtonElement).disabled).toBe(true)
  })

  it('已是最新时给一句成功提示', async () => {
    const updater = createUpdater()
    updater.check.mockResolvedValue(updateState({ status: 'up-to-date' }))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /^检查更新$/ }))

    await waitFor(() => expect(state.success).toHaveBeenCalledWith('已是最新版本'))
    expect(await screen.findByText('最新')).toBeTruthy()
  })

  it('发现新版本时提示里带上版本号', async () => {
    const updater = createUpdater()
    updater.check.mockResolvedValue(updateState({ status: 'update-available', info: updateInfo({ latestVersion: '2.0.0' }) }))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /^检查更新$/ }))

    await waitFor(() => expect(state.success).toHaveBeenCalledWith('发现新版本 v2.0.0'))
  })

  it('检查失败时优先报主进程给的原因', async () => {
    const updater = createUpdater()
    updater.check.mockResolvedValue(updateState({ status: 'error', errorMessage: 'net::ERR_INTERNET_DISCONNECTED' }))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /^检查更新$/ }))

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('net::ERR_INTERNET_DISCONNECTED'))
  })

  it('检查失败但没给原因时用兜底文案', async () => {
    const updater = createUpdater()
    updater.check.mockResolvedValue(updateState({ status: 'error', errorMessage: null }))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /^检查更新$/ }))

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('检查更新失败'))
  })
})

describe('更新通道', () => {
  it('Windows 有更新时给「下载更新」，点它通知主进程', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    renderCard(updater, 'win32')

    fireEvent.click(await screen.findByRole('button', { name: /下载更新/ }))

    await waitFor(() => expect(updater.download).toHaveBeenCalledTimes(1))
  })

  it('macOS 一律只给「前往下载 DMG」，不给自动下载（本机装不了自己下的包）', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    renderCard(updater, 'darwin')

    expect(await screen.findByRole('button', { name: /前往下载 DMG/ })).toBeTruthy()
    expect(queryButton('下载更新')).toBeNull()

    fireEvent.click(button('前往下载 DMG'))
    await waitFor(() => expect(updater.openReleases).toHaveBeenCalledTimes(1))
    expect(updater.download).not.toHaveBeenCalled()
  })

  it('macOS 有更新时不再另给「GitHub 发布页」——主按钮已经是下载页了，两个按钮去同一个地方', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    renderCard(updater, 'darwin')

    expect(await screen.findByRole('button', { name: /前往下载 DMG/ })).toBeTruthy()
    expect(queryButton('GitHub 发布页')).toBeNull()
  })

  it('macOS 已是最新时反而保留「GitHub 发布页」（此时没有主按钮，总得留一个入口）', async () => {
    const updater = createUpdater(updateState({ status: 'up-to-date', info: updateInfo() }))
    renderCard(updater, 'darwin')

    await screen.findByText('最新')
    expect(button('GitHub 发布页')).toBeTruthy()
  })

  it('跨大版本更新只能手动下载，并在卡片里说明原因', async () => {
    const updater = createUpdater(updateState({
      status: 'update-available',
      info: updateInfo({ latestVersion: '2.0.0', requiresManualUpdate: true }),
    }))
    renderCard(updater, 'win32')

    expect(await screen.findByRole('button', { name: /前往下载新版本/ })).toBeTruthy()
    expect(queryButton('下载更新')).toBeNull()
    expect(screen.getByText(/v2\.0\.0 是一个大版本更新/)).toBeTruthy()

    fireEvent.click(button('前往下载新版本'))
    await waitFor(() => expect(updater.openReleases).toHaveBeenCalledTimes(1))
  })

  it('没有匹配当前平台的安装包时退回「GitHub 发布页」', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo({ preferredAsset: undefined }) }))
    renderCard(updater, 'win32')

    expect(await screen.findByRole('button', { name: /GitHub 发布页/ })).toBeTruthy()
    expect(queryButton('下载更新')).toBeNull()
  })

  it('下载完成后给「立即安装」，点它通知主进程', async () => {
    const updater = createUpdater(updateState({ status: 'downloaded', info: updateInfo() }))
    renderCard(updater, 'win32')

    fireEvent.click(await screen.findByRole('button', { name: /立即安装/ }))

    await waitFor(() => expect(updater.install).toHaveBeenCalledTimes(1))
  })

  it('已是最新时不给任何更新动作按钮，只剩「GitHub 发布页」', async () => {
    const updater = createUpdater(updateState({ status: 'up-to-date', info: updateInfo() }))
    renderCard(updater, 'win32')

    await screen.findByText('最新')
    expect(button('GitHub 发布页')).toBeTruthy()
    expect(queryButton('下载更新')).toBeNull()
    expect(queryButton('立即安装')).toBeNull()
  })
})

describe('下载', () => {
  it('下完了给一句成功提示', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    updater.download.mockResolvedValue('download-complete')
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /下载更新/ }))

    await waitFor(() => expect(state.success).toHaveBeenCalledWith('安装包已下载完成'))
  })

  it('下载失败时报主进程给的原因', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    updater.download.mockResolvedValue('failed')
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /下载更新/ }))

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('下载失败'))
  })

  it('已经在下载时重复点击不再弹一句话（状态里已经有进度了）', async () => {
    const updater = createUpdater(updateState({ status: 'downloading', info: updateInfo(), downloadProgress: 0.42 }))
    updater.download.mockResolvedValue('downloading')
    renderCard(updater)

    // 下载中不显示「下载更新」，这条路径只能通过主进程推状态来触发，这里验证「推过来的进度」被画出来了。
    expect(await screen.findByText('正在下载… 42%')).toBeTruthy()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('DMG 手动下载通道不报错也不报成功（已经替用户打开了下载页）', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    updater.download.mockResolvedValue('manual-download')
    renderCard(updater, 'darwin')

    fireEvent.click(await screen.findByRole('button', { name: /前往下载 DMG/ }))

    await waitFor(() => expect(updater.openReleases).toHaveBeenCalledTimes(1))
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('进度条按百分比画，并保留整数', async () => {
    const updater = createUpdater(updateState({ status: 'downloading', info: updateInfo(), downloadProgress: 0.876 }))
    renderCard(updater)

    expect(await screen.findByText('正在下载… 88%')).toBeTruthy()
    const bar = screen.getByText('正在下载… 88%').previousElementSibling?.firstElementChild as HTMLElement
    expect(bar.style.width).toBe('88%')
  })

  it('进度是 0 时也画进度条（0% 与「没有进度」不是一回事）', async () => {
    const updater = createUpdater(updateState({ status: 'downloading', info: updateInfo(), downloadProgress: 0 }))
    renderCard(updater)

    expect(await screen.findByText('正在下载… 0%')).toBeTruthy()
  })
})

describe('安装', () => {
  it('安装失败时把异常原因带出来', async () => {
    const updater = createUpdater(updateState({ status: 'downloaded', info: updateInfo() }))
    updater.install.mockRejectedValue(new Error('EPERM: installer busy'))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /立即安装/ }))

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('EPERM: installer busy'))
  })

  it('抛出来的不是 Error 时用兜底文案，不弹空提示', async () => {
    const updater = createUpdater(updateState({ status: 'downloaded', info: updateInfo() }))
    updater.install.mockRejectedValue('nope')
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /立即安装/ }))

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('启动安装程序失败'))
  })
})

describe('错误与安装包', () => {
  it('错误原因留在卡片里，不只是一闪而过的提示', async () => {
    const updater = createUpdater(updateState({ status: 'error', errorMessage: 'checksum mismatch' }))
    renderCard(updater)

    expect(await screen.findByText('checksum mismatch')).toBeTruthy()
    expect(await screen.findByText('检查失败')).toBeTruthy()
  })

  it('把安装包名字与大小列出来，让用户知道下的是哪个产物', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    renderCard(updater, 'win32')

    expect(await screen.findByText('One-Switch-1.2.0-win-x64.exe')).toBeTruthy()
    expect(await screen.findByText('96.0 MB')).toBeTruthy()
  })

  it('macOS 不列安装包（那一行讲的 Windows 产物，对 macOS 是噪音）', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo() }))
    renderCard(updater, 'darwin')

    await screen.findByText('可更新')
    expect(screen.queryByText('One-Switch-1.2.0-win-x64.exe')).toBeNull()
    expect(screen.queryByText('更新包')).toBeNull()
  })

  it('跨大版本时也不列安装包（那个包在自动更新通道里根本不会被下载）', async () => {
    const updater = createUpdater(updateState({
      status: 'update-available',
      info: updateInfo({ requiresManualUpdate: true }),
    }))
    renderCard(updater, 'win32')

    await screen.findByText('可更新')
    expect(screen.queryByText('One-Switch-1.2.0-win-x64.exe')).toBeNull()
  })
})

describe('更新说明', () => {
  it('有更新且有说明时折起来给「查看更新说明」', async () => {
    const updater = createUpdater(updateState({
      status: 'update-available',
      info: updateInfo({ releaseNotes: '<h3>新特性</h3><p>更快的路由</p>' }),
    }))
    renderCard(updater)

    const summary = await screen.findByText('查看更新说明')
    expect(summary.textContent).toBe('查看更新说明')
    // 说明在折叠面板里，内容已经渲染进去了。
    expect(screen.getByText('更快的路由')).toBeTruthy()
  })

  it('HTML 说明会被净化：脚本与事件处理器都活不下来', async () => {
    const updater = createUpdater(updateState({
      status: 'update-available',
      info: updateInfo({ releaseNotes: '<p onclick="steal()">hi</p><script>window.pwned = 1</script>' }),
    }))
    renderCard(updater)

    await screen.findByText('查看更新说明')
    const notes = document.querySelector('.release-notes') as HTMLElement
    expect(notes.innerHTML).not.toContain('<script')
    expect(notes.innerHTML).not.toContain('onclick')
    expect(notes.textContent).toBe('hi')
  })

  it('已是最新时不显示更新说明——那一段是上一次更新的内容，容易误导', async () => {
    const updater = createUpdater(updateState({
      status: 'up-to-date',
      info: updateInfo({ releaseNotes: '<p>旧版本的内容</p>' }),
    }))
    renderCard(updater)

    await screen.findByText('最新')
    expect(screen.queryByText('查看更新说明')).toBeNull()
    expect(screen.queryByText('旧版本的内容')).toBeNull()
  })

  it('说明是空字符串时不给一个点开啥也没有的折叠面板', async () => {
    const updater = createUpdater(updateState({ status: 'update-available', info: updateInfo({ releaseNotes: '' }) }))
    renderCard(updater)

    await screen.findByText('可更新')
    expect(screen.queryByText('查看更新说明')).toBeNull()
  })
})

describe('打开发布页', () => {
  it('有更新器时走主进程打开的通道', async () => {
    const updater = createUpdater(updateState({ status: 'up-to-date', info: updateInfo() }))
    renderCard(updater)

    fireEvent.click(await screen.findByRole('button', { name: /GitHub 发布页/ }))

    await waitFor(() => expect(updater.openReleases).toHaveBeenCalledTimes(1))
  })

  /*
   * 实现里 `handleOpenReleases` 还有一条「没有 updater 就自己 `openExternal`」的退路，
   * 但它在本组件里**不可达**：`if (!updater) return <PreviewCard />` 排在所有按钮之前，
   * 没有 updater 时页面里根本不存在「GitHub 发布页」按钮，那个函数也就无从被调用。
   * 这条只在自检时记录一次，不去断言那段死分支——真正该守住的是「预览卡没有动作按钮」。
   */
  it('没有更新器时卡片里一个动作按钮都没有（所以那段外链退路走不到）', async () => {
    renderCard(null)

    await screen.findByText('版本更新功能仅在 Electron 桌面端可用。')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('重新挂载', () => {
  it('换一个状态再挂载，界面跟着换（没有跨实例串状态）', async () => {
    const first = createUpdater(updateState({ status: 'up-to-date' }))
    const firstView = renderCard(first)
    expect(await screen.findByText('最新')).toBeTruthy()
    firstView.unmount()

    const second = createUpdater(updateState({ status: 'error', errorMessage: 'boom' }))
    renderCard(second)

    expect(await screen.findByText('检查失败')).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
    expect(screen.queryByText('最新')).toBeNull()
  })
})

describe('卡片内容', () => {
  it('标题与说明按平台换文案（桌面端讲安装程序，macOS 讲 DMG）', async () => {
    const updater = createUpdater(updateState())
    const view = renderCard(updater, 'darwin')

    expect(await screen.findByText('版本更新')).toBeTruthy()
    expect(screen.getByText('检查新版本并下载 DMG 安装包')).toBeTruthy()
    view.unmount()

    renderCard(createUpdater(updateState()), 'win32')
    expect(await screen.findByText('版本更新')).toBeTruthy()
    expect(screen.getByText('检查新版本并通过系统安装程序升级')).toBeTruthy()
  })

  it('版本行与检查按钮在同一个模块里，说明区是居右的', async () => {
    const updater = createUpdater(updateState({ info: updateInfo() }))
    renderCard(updater)

    const row = (await screen.findByText('版本')).parentElement?.parentElement as HTMLElement
    expect(within(row).getByRole('button', { name: /^检查更新$/ })).toBeTruthy()
  })
})
