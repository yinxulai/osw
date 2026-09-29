import { describe, expect, it } from 'vitest'
import {
  resolveWindowShortcut,
  type WindowAction,
  type WindowShortcutInput,
} from './window-shortcuts'

function shortcut(key: string, overrides: Partial<WindowShortcutInput> = {}): WindowShortcutInput {
  return {
    key,
    meta: false,
    control: false,
    shift: false,
    alt: false,
    ...overrides,
  }
}

describe('resolveWindowShortcut', () => {
  it('maps macOS command shortcuts', () => {
    const cases: Array<[string, Partial<WindowShortcutInput>, WindowAction]> = [
      ['q', { meta: true }, 'quit'],
      ['w', { meta: true }, 'close'],
      ['m', { meta: true }, 'minimize'],
      ['z', { meta: true }, 'undo'],
      ['z', { meta: true, shift: true }, 'redo'],
      ['r', { meta: true }, 'reload'],
      ['r', { meta: true, shift: true }, 'forceReload'],
      ['+', { meta: true }, 'zoomIn'],
      ['0', { meta: true }, 'resetZoom'],
      ['f', { meta: true, control: true }, 'toggleFullScreen'],
      ['i', { meta: true, alt: true }, 'toggleDevTools'],
    ]

    for (const [key, modifiers, expected] of cases) {
      expect(resolveWindowShortcut(shortcut(key, modifiers), 'darwin')).toBe(expected)
    }
  })

  it('maps Windows and Linux control shortcuts', () => {
    expect(resolveWindowShortcut(shortcut('F11'), 'win32')).toBe('toggleFullScreen')
    expect(resolveWindowShortcut(shortcut('q', { control: true }), 'win32')).toBe('quit')
    expect(resolveWindowShortcut(shortcut('y', { control: true }), 'linux')).toBe('redo')
    expect(resolveWindowShortcut(shortcut('i', { control: true, shift: true }), 'win32')).toBe(
      'toggleDevTools',
    )
  })

  it('does not consume unmodified or unrelated keys', () => {
    expect(resolveWindowShortcut(shortcut('q'), 'darwin')).toBeNull()
    expect(resolveWindowShortcut(shortcut('q', { control: true }), 'darwin')).toBeNull()
    expect(resolveWindowShortcut(shortcut('b', { meta: true }), 'darwin')).toBeNull()
    expect(resolveWindowShortcut(shortcut('i', { control: true }), 'linux')).toBeNull()
  })
})
