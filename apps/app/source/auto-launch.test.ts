import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(),
    setLoginItemSettings: vi.fn(),
  },
}))

vi.mock('./server-host', () => ({
  getSettings: vi.fn(),
  onSettingsChanged: vi.fn(),
}))

import { shouldStartHidden, type StartHiddenInput } from './auto-launch'

function signals(overrides: Partial<StartHiddenInput> = {}): StartHiddenInput {
  return {
    platform: 'darwin',
    argv: ['/Applications/OSW.app/Contents/MacOS/OSW'],
    wasOpenedAtLogin: false,
    ...overrides,
  }
}

describe('shouldStartHidden', () => {
  it('hides a macOS login launch that did not receive --hidden', () => {
    expect(shouldStartHidden(signals({ wasOpenedAtLogin: true }))).toBe(true)
  })

  it('shows a macOS launch the user started themselves', () => {
    expect(shouldStartHidden(signals({ wasOpenedAtLogin: false }))).toBe(false)
  })

  it('still hides when the login item passed --hidden', () => {
    expect(shouldStartHidden(signals({
      platform: 'win32',
      argv: ['OSW.exe', '--hidden'],
      wasOpenedAtLogin: false,
    }))).toBe(true)
    expect(shouldStartHidden(signals({
      platform: 'linux',
      argv: ['osw', '--hidden'],
    }))).toBe(true)
  })

  it('does not treat wasOpenedAtLogin as a hide signal off macOS', () => {
    expect(shouldStartHidden(signals({
      platform: 'win32',
      argv: ['OSW.exe'],
      wasOpenedAtLogin: true,
    }))).toBe(false)
    expect(shouldStartHidden(signals({
      platform: 'linux',
      argv: ['osw'],
      wasOpenedAtLogin: true,
    }))).toBe(false)
  })
})
