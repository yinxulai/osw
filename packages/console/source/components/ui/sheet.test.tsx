// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/provider'
import { Sheet, SheetContent, SheetTitle } from './sheet'

// 形态与全屏状态由这两处决定，用例里当开关摆布；判定本身在 `platform/window-controls.test.ts` 里验。
const state = vi.hoisted(() => ({
  name: 'electron' as 'electron' | 'web',
  os: 'win32' as 'darwin' | 'win32' | 'linux' | 'unknown',
  fullScreen: false,
}))

vi.mock('@/platform/capabilities', () => ({
  getPlatformCapabilities: () => ({ name: state.name, os: state.os }),
}))
vi.mock('@/hooks/use-window-full-screen', () => ({
  useWindowFullScreen: () => state.fullScreen,
}))
// `I18nProvider` 会读服务端设置，单测里不需要也不该走 react-query（同 `request-contents-sheet.test.tsx`）。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function renderSheet(side: 'right' | 'left' = 'right') {
  return render(
    <I18nProvider>
      <Sheet open>
        <SheetContent side={side}>
          <SheetTitle>面板</SheetTitle>
        </SheetContent>
      </Sheet>
    </I18nProvider>,
  )
}

function contentClass(): string {
  return screen.getByRole('dialog').className
}

/**
 * 面板是 portal 到 `<body>` 的整屏高浮层，`side="right"` 时右上角就是窗口右上角，
 * 正好压在系统窗口控件（最小化 / 最大化 / 关闭）那块保留区上，关闭按钮会被盖住。
 * 修法是让面板整体从标题栏下方开始，而**不是**加层级——那块地渲染层用不了。
 */
describe('SheetContent 避让系统窗口控件', () => {
  beforeEach(() => {
    state.name = 'electron'
    state.os = 'win32'
    state.fullScreen = false
  })

  it('Windows 窗口态下右侧面板整体让出标题栏', () => {
    renderSheet('right')
    expect(contentClass()).toContain('top-9!')
    // 高度必须跟着改，否则面板仍以整屏高计算，底部内容会被顶出可视区。
    expect(contentClass()).toContain('h-auto!')
  })

  it('系统控件不在右上角时不动面板', () => {
    state.os = 'darwin'
    renderSheet('right')
    expect(contentClass()).not.toContain('top-9!')
  })

  it('原生全屏下把让出的那块还回来', () => {
    state.fullScreen = true
    renderSheet('right')
    expect(contentClass()).not.toContain('top-9!')
  })

  // 只有压在窗口右边缘的那一侧才会撞上保留区；左侧面板跟着下移纯属多余的留白。
  it('左侧面板不受影响', () => {
    renderSheet('left')
    expect(contentClass()).not.toContain('top-9!')
  })

  it('默认关闭按钮仍然渲染', () => {
    renderSheet('right')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})
