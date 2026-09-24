import type {
  CloudSyncConfigureRequest,
  CloudSyncPullResult,
  CloudSyncPushResult,
  CloudSyncStatus,
} from '@common/cloud-sync'
import { request } from './client'

/**
 * 云同步的管理接口。
 *
 * 全部是 `POST`，与其余管理接口一致；路径**不含** `/api` 前缀，基地址由 `request` 自己拼。
 */
export const cloudSyncApi = {
  status: () => request<CloudSyncStatus>('/cloud-sync/status'),
  configure: (input: CloudSyncConfigureRequest) => request<CloudSyncStatus>('/cloud-sync/configure', input),
  test: () => request<CloudSyncStatus>('/cloud-sync/test'),
  push: () => request<CloudSyncPushResult>('/cloud-sync/push'),
  pull: () => request<CloudSyncPullResult>('/cloud-sync/pull'),
}
