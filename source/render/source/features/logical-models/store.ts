import type { LogicalModel } from '@common/schemas'
import { createStore } from '@/store/create-store'
export interface LogicalModelsState { data: LogicalModel[]; loading: boolean; error: string | null; loaded: boolean }
export const logicalModelsStore = createStore<LogicalModelsState>({ data: [], loading: false, error: null, loaded: false })
