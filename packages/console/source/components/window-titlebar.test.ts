import { describe, expect, it } from 'vitest'
import { resolveWindowTitlebarInsets } from './window-titlebar'

describe('resolveWindowTitlebarInsets', () => {
  it('reserves system window controls while windowed', () => {
    expect(resolveWindowTitlebarInsets('darwin', false)).toBe('pr-4 pl-20')
    expect(resolveWindowTitlebarInsets('win32', false)).toBe('pr-40 pl-4')
  })

  it('reclaims the system window controls area in native fullscreen', () => {
    expect(resolveWindowTitlebarInsets('darwin', true)).toBe('pr-4 pl-4')
    expect(resolveWindowTitlebarInsets('win32', true)).toBe('pr-4 pl-4')
  })
})
