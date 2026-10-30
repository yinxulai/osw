import { useEffect, useState, useSyncExternalStore } from 'react'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { REPOSITORY_RELEASES_URL } from '@/lib/external-links'
import { getPlatformCapabilities } from '@/platform/capabilities'
import { UpdaterController, type UpdaterSnapshot } from '../lib/updater-controller'

/**
 * 更新器是 contextBridge 暴露出来的跨进程对象，只能经 `getPlatformCapabilities()` 取——
 * 浏览器预览形态下根本没有这个 API。引用在控制器里恒定一次即可。
 */
function getUpdater(): UpdaterAPI | undefined {
  return getPlatformCapabilities().updater ?? undefined
}

export interface UseUpdater {
  available: boolean
  isMacOS: boolean
  state: UpdaterSnapshot
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  openReleases: () => Promise<void>
}

/**
 * {@link UpdaterController} 与渲染层之间的薄绑定。
 *
 * 状态机在控制器里（零 React、可单测）；这个 hook 只做三件 React 专属的事：
 * 订阅控制器状态、接上生命周期、把控制器返回的结构化结果翻译成 toast。
 */
export function useUpdater(): UseUpdater {
  const toast = useToast()
  const t = useTranslation()
  const [controller] = useState(() => new UpdaterController(getUpdater()))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  useEffect(() => controller.start(), [controller])

  const check = async () => {
    const outcome = await controller.check()
    switch (outcome.kind) {
      case 'up-to-date':
        toast.success(t('settings.update.upToDateToast'))
        break
      case 'update-available':
        toast.success(t('settings.update.availableToast', { version: outcome.version }))
        break
      case 'ready-to-install':
        toast.success(t('settings.update.readyToInstallToast', { version: outcome.version }))
        break
      case 'ready-with-error':
        toast.error(outcome.message)
        break
      case 'error':
        toast.error(outcome.message ?? t('settings.update.checkFailed'))
        break
      case 'failed':
        toast.error(outcome.message ?? t('settings.update.checkFailed'))
        break
      default:
        break
    }
  }

  const download = async () => {
    const outcome = await controller.download()
    if (outcome.kind === 'failed') toast.error(outcome.message ?? t('settings.update.downloadFailed'))
    else if (outcome.kind === 'downloaded') toast.success(t('settings.update.downloadedToast'))
  }

  const install = async () => {
    try {
      await controller.install()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.update.installFailed'))
    }
  }

  const openReleases = async () => {
    if (!controller.available) {
      getPlatformCapabilities().openExternal(REPOSITORY_RELEASES_URL)
      return
    }
    await controller.openReleases()
  }

  return {
    available: controller.available,
    isMacOS: getPlatformCapabilities().os === 'darwin',
    state,
    check,
    download,
    install,
    openReleases,
  }
}
