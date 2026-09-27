import { createJSONStorage, type PersistStorage } from 'zustand/middleware'

/**
 * Create a persist storage only when the host actually provides one.
 *
 * `window.localStorage` is not guaranteed to exist or be usable: jsdom tests can omit it,
 * privacy modes can reject access, and non-browser hosts do not expose it at all. Zustand's
 * default storage is created eagerly, so an unavailable implementation fails later on the
 * first write. Returning `undefined` here lets `persist` keep the store in memory instead.
 */
export function createLocalStorage<PersistedState>(): PersistStorage<PersistedState> | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    const storage = window.localStorage
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
    ) {
      return undefined
    }
    return createJSONStorage<PersistedState>(() => storage)
  } catch {
    return undefined
  }
}
