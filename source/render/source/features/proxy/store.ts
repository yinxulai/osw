import type { ProxyServerStatus } from '@common/schemas'
import { createStore } from '@/store/create-store'

export interface ProxyState { data: ProxyServerStatus | null; loading: boolean; error: string | null; loaded: boolean }
export const proxyStore = createStore<ProxyState>({ data: null, loading: false, error: null, loaded: false })
