import { useLogicalModelControl } from './hooks/use-logical-model-control'
import type { LogicalModelKeysRef } from './queries'

/** 页面组合层：领域行为由 logical-models hooks 管理，保持页面现有消费契约。 */
export function useLogicalModelControlService(logicalModel: LogicalModelKeysRef | null) {
  return useLogicalModelControl(logicalModel)
}
