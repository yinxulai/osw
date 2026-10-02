import { describe, expect, it, vi } from 'vitest'
import { evaluateCapture, type CaptureReadiness } from './screenshot-export'

// `screenshot-export` 的顶层 import 会拉起 `electron`；本文件只测那个纯判定函数，
// 把宿主模块换成一个空壳即可（否则在 Node 测试环境里连模块都加载不进来）。
vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeImage: { createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({ toPNG: vi.fn(() => Buffer.alloc(0)) })) })) },
}))

const sample = (overrides: Partial<CaptureReadiness> = {}): CaptureReadiness => ({
  hasRuntime: true,
  rootChildren: 1,
  pendingImages: 0,
  ...overrides,
})

/**
 * 判定函数是「拍不拍空白图」这条线的唯一决策点，所以它必须纯粹、可枚举。
 *
 * 背景：原实现只要窗口存在就开拍，渲染进程因为同步 IPC 被卡住时会安安静静地导出一整套
 * 空白 PNG——图片尺寸、数量、退出码全都正常，只有内容是白的。真正致命的失败模式是
 * **看起来成功**，所以判定要「没内容就算没画出来」，而不是「没报错就算画出来了」。
 */
describe('evaluateCapture', () => {
  it('treats a page with no runtime config as empty', () => {
    // `apiBase` 没拿到 = preload 的同步 IPC 没回来，页面主线程还没走起来。
    expect(evaluateCapture(sample({ hasRuntime: false }), false)).toBe('empty')
  })

  it('treats a mounted-but-childless root as empty', () => {
    // 挂载点有了、里面什么都没有，同样是「路由还没渲染」。
    expect(evaluateCapture(sample({ rootChildren: 0 }), false)).toBe('empty')
    expect(evaluateCapture(sample({ rootChildren: 0, hasRuntime: false }), true)).toBe('empty')
  })

  it('treats rendered content with images still loading as content, not ready', () => {
    expect(evaluateCapture(sample({ pendingImages: 2 }), false)).toBe('content')
  })

  it('treats content as ready once every image has settled', () => {
    expect(evaluateCapture(sample({ pendingImages: 0 }), false)).toBe('ready')
  })

  it('treats content as ready when the image grace window has expired', () => {
    // 一张永远加载不完的坏图不能把整轮导出拖到超时——宽限期一到就按「画好了」算。
    expect(evaluateCapture(sample({ pendingImages: 3 }), true)).toBe('ready')
  })
})
