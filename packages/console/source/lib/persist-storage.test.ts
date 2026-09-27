// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from './persist-storage'

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function restoreStorage(): void {
  if (originalStorageDescriptor) {
    Object.defineProperty(window, 'localStorage', originalStorageDescriptor)
    return
  }
  Reflect.deleteProperty(window, 'localStorage')
}

afterEach(restoreStorage)

describe('createLocalStorage', () => {
  it('returns undefined when accessing window.localStorage throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage disabled')
      },
    })

    expect(createLocalStorage()).toBeUndefined()
  })

  it('returns undefined when the host only exposes part of the Storage API', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
      },
    })

    expect(createLocalStorage()).toBeUndefined()
  })

  it('wraps the host storage when the full API is available', () => {
    const setItem = vi.fn()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem,
        removeItem: vi.fn(),
      },
    })
    const storage = createLocalStorage<{ themeMode: string }>()

    storage?.setItem('osw-ui', { state: { themeMode: 'dark' }, version: 0 })

    expect(setItem).toHaveBeenCalledWith('osw-ui', JSON.stringify({
      state: { themeMode: 'dark' },
      version: 0,
    }))
  })
})
