import { settingsApi } from '@/api/runtime'
import { deepEqual } from '@/infrastructure/deep-equal'
import { pollingManager } from '@/infrastructure/polling-manager'
import { settingsStore } from './store'
const update = async (silent: boolean) => { if (!silent) settingsStore.setState({ loading: true }); const result = await settingsApi.get(); if (result.success) settingsStore.setState(current => ({ data: deepEqual(current.data, result.data) ? current.data : result.data, loading: false, error: null, loaded: true })); else settingsStore.setState({ loading: false, error: result.errorMessage, loaded: true }) }
export const settingsService = { subscribe: () => pollingManager.subscribe('settings', 15000, update), refresh: () => void update(true) }
