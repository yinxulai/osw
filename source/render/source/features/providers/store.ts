import type { Provider } from '@common/schemas'
import { createStore } from '@/store/create-store'
export interface ProvidersState { data: Provider[]; loading: boolean; error: string | null; loaded: boolean }
export const providersStore = createStore<ProvidersState>({ data: [], loading: false, error: null, loaded: false })
