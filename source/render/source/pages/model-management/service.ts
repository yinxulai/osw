import { useModelManagement } from './hooks/use-model-management'

/** 页面组合层：领域行为分别由 hooks 管理，保持页面现有消费契约。 */
export function useModelManagementService() {
  return useModelManagement()
}
