import { logicalModelApi } from '@/api/models'
import { deepEqual } from '@/infrastructure/deep-equal'
import { pollingManager } from '@/infrastructure/polling-manager'
import { logicalModelsStore } from './store'
const update = async (silent: boolean) => { if (!silent) logicalModelsStore.setState({ loading: true }); const result = await logicalModelApi.list(); if (result.success) logicalModelsStore.setState(current => ({ data: deepEqual(current.data, result.data) ? current.data : result.data, loading: false, error: null, loaded: true })); else logicalModelsStore.setState({ loading: false, error: result.errorMessage, loaded: true }) }
export const logicalModelsService = { subscribe: () => pollingManager.subscribe('logical-models', 30000, update), refresh: () => void update(true) }
