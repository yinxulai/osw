import type { Settings } from '@common/schemas'
import { createStore } from '@/store/create-store'
export interface SettingsState { data: Settings | null; loading: boolean; error: string | null; loaded: boolean }
export const settingsStore = createStore<SettingsState>({ data: null, loading: false, error: null, loaded: false })
