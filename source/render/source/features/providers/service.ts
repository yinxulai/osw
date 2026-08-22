import type { Provider } from '@common/schemas'
import { providerApi } from '@/api/providers'
import { deepEqual } from '@/infrastructure/deep-equal'
import { pollingManager } from '@/infrastructure/polling-manager'
import { providersStore } from './store'
const update = async (silent: boolean) => { if (!silent) providersStore.setState({ loading: true }); const result = await providerApi.list(); if (result.success) providersStore.setState(current => ({ data: deepEqual(current.data, result.data) ? current.data : result.data, loading: false, error: null, loaded: true })); else providersStore.setState({ loading: false, error: result.errorMessage, loaded: true }) }
export const providersService = { subscribe: () => pollingManager.subscribe('providers', 10000, update), refresh: () => void update(true) }
export type { Provider }
