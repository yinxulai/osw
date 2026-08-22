import { useQueueControl } from './hooks/use-queue-control'

/** 页面组合层：领域行为由 queue-control hooks 管理，保持页面现有消费契约。 */
export function useQueueControlService() {
  return useQueueControl()
}
