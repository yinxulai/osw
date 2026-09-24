import { useCallback, useMemo, useState } from 'react'
import type { CloudBackupDescriptor, CloudBackupKind } from '@common/cloud-backup'
import type { CloudSyncConfigureRequest } from '@common/cloud-sync'
import { localizeError } from '@/api/errors'
import { useCloudSyncActions, useCloudSyncLoading, useCloudSyncStatus } from '@/data/cloud-sync'
import { useTranslation } from '@/i18n/provider'

export type CloudSyncStep = 'configure' | 'test' | 'push' | 'pull'

/**
 * 云同步的动作编排。
 *
 * 与服务端的每个动作一一对应，但**共用一份 busy 与提示**：这几行控件挤在同一张卡里，
 * 各自持一份状态就会出现「上传转着圈、下面那行却显示上一次的错误」。
 *
 * 结果提示用一句话回执（`uploadDone` / `downloadDone`），不是静默成功：
 * 这两个按钮会改动很多行数据，用户需要知道到底搬了多少东西，而不只是「没报错」。
 *
 * 返回的 `descriptor` 是当前承载方式的自述，界面据此渲染标题与占位符，卡片里因此没有
 * 一行属于某个具体后端的文案——接一种新的承载方式不用动界面。
 */
export function useCloudSync() {
  const t = useTranslation()
  const status = useCloudSyncStatus()
  const loading = useCloudSyncLoading()
  const actions = useCloudSyncActions()
  const [pending, setPending] = useState<CloudSyncStep | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 状态里回的后端列表就是注册表的快照，这里只做一次「当前是哪一个」的查找。
  const descriptor: CloudBackupDescriptor | null = useMemo(() => {
    if (!status) return null
    return status.providers.find(item => item.kind === status.provider) ?? null
  }, [status])

  /** 每个动作的开场都一样：清掉上一次的结果、记下「正在做哪一步」。 */
  const begin = useCallback((step: CloudSyncStep) => {
    setPending(step)
    setMessage(null)
    setErrorMessage(null)
  }, [])

  const fail = useCallback((error: unknown) => {
    setPending(null)
    setErrorMessage(localizeError(t, error))
  }, [t])

  /**
   * 换承载方式 / 保存凭据 / 绑定远端**不单独报成功**：这几行的描述行会立刻变成
   * 「已连接为 @x」与「已绑定 xxx」，那就是反馈本身，再弹一句只会重复。
   * 失败则必须报，因为行内看不出区别。
   *
   * 返回布尔值而不是抛错：调用方要在成功后才清空输入框（失败时留着让用户改）。
   */
  const configure = useCallback(async (input: CloudSyncConfigureRequest): Promise<boolean> => {
    begin('configure')
    try {
      await actions.configure.mutateAsync(input)
      setPending(null)
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }, [actions.configure, begin, fail])

  const selectProvider = useCallback((kind: CloudBackupKind) => configure({ provider: kind }), [configure])
  const saveCredential = useCallback((credential: string) => configure({ credential }), [configure])
  const bindTarget = useCallback((target: string) => configure({ target }), [configure])

  const clearCredential = useCallback(async (): Promise<void> => {
    // 空串是「清除」而不是「不动这一项」（见 `CloudSyncConfigureRequestSchema`）。
    await configure({ credential: '' })
  }, [configure])

  const push = useCallback(async (): Promise<void> => {
    begin('push')
    try {
      const result = await actions.push.mutateAsync()
      setPending(null)
      setMessage(t('settings.cloudSync.uploadDone', result.pushed))
    } catch (error) {
      fail(error)
    }
  }, [actions.push, begin, fail, t])

  const pull = useCallback(async (): Promise<void> => {
    begin('pull')
    try {
      const result = await actions.pull.mutateAsync()
      setPending(null)
      setMessage(t('settings.cloudSync.downloadDone', result.pulled))
    } catch (error) {
      fail(error)
    }
  }, [actions.pull, begin, fail, t])

  return {
    status,
    descriptor,
    loading,
    pending,
    busy: pending !== null,
    message,
    errorMessage,
    selectProvider,
    saveCredential,
    clearCredential,
    bindTarget,
    push,
    pull,
  }
}
