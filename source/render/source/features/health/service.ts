import { healthApi } from '@/api/runtime'
import { deepEqual } from '@/infrastructure/deep-equal'
import { pollingManager } from '@/infrastructure/polling-manager'
import { healthStore } from './store'
const update = async (silent: boolean) => { if (!silent) healthStore.setState({ loading: true }); const result = await healthApi.list(); if (result.success) { const providers = Object.fromEntries(result.data.providers.map(item => [item.providerId, item])); const providerModels = Object.fromEntries(result.data.providerModels.map(item => [item.providerModelId, item])); healthStore.setState(current => ({ providers: deepEqual(current.providers, providers) ? current.providers : providers, providerModels: deepEqual(current.providerModels, providerModels) ? current.providerModels : providerModels, loading: false, error: null, loaded: true })) } else healthStore.setState({ loading: false, error: result.errorMessage, loaded: true }) }
export const healthService = { subscribe: () => pollingManager.subscribe('health', 5000, update), refresh: () => void update(true) }
