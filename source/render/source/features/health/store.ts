import type { ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { createStore } from '@/store/create-store'
export interface HealthState { providers: Record<string, ProviderHealth>; providerModels: Record<string, ProviderModelHealth>; loading: boolean; error: string | null; loaded: boolean }
export const healthStore = createStore<HealthState>({ providers: {}, providerModels: {}, loading: false, error: null, loaded: false })
