import { useEffect, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { Download, ExternalLink, Package, RefreshCw, Rocket } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { useToast } from '@/components/ui/toast'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatBytes } from '@/lib/format-bytes'
import { getPlatformCapabilities } from '@/platform/capabilities'

type StatusBadgeProps = {
  status: UpdateCheckStatus
}

/**
 * 更新器是 contextBridge 暴露出来的跨进程对象，只能经 `getPlatformCapabilities()` 取——
 * 惰性探测一次并缓存整个对象，引用恒定。
 *
 * 引用必须恒定，且不能直接读 `window.electronAPI`：浏览器形态下根本没有这个 API，而跨进程
 * 对象的引用不保证稳定。一旦引用不稳定，下面的 effect 就会反复执行
 * 「refresh() → setState → 重渲染 → 引用又变了 → 再 refresh()」，形成无终止的同步更新链。
 */
function getUpdater(): UpdaterAPI | undefined {
  return getPlatformCapabilities().updater ?? undefined
}

/**
 * 跨进程传回来的状态对象每次都是新实例，值没变就不该触发重渲染。
 * 字段不多但 `info.assets` 是数组，逐字段比容易漏，直接序列化比。
 */
function isSameState(a: UpdateState, b: UpdateState): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 日期按当前界面语言格式化，不再写死 zh-CN。 */
function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type UpdateActionsProps = {
  status: UpdateCheckStatus
  isMacOS: boolean
  hasUpdate: boolean
  hasPreferredAsset: boolean
  requiresManualUpdate: boolean
  onInstall: () => void
  onDownload: () => void
  onOpenReleases: () => void
}

type VersionInfoProps = {
  info: UpdateInfo | null
}

type ReleaseNotesProps = {
  info: UpdateInfo | null
  hasUpdate: boolean
}

type DownloadProgressProps = {
  progress: number | null
}

function PreviewCard() {
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader
        icon={<Package />}
        title={t('settings.update.title')}
        description={t('settings.update.descriptionMacOS')}
      />
      <CardContent className="px-4 py-3">
        <p className="system-xs-regular text-text-tertiary">
          {t('settings.update.previewOnly')}
        </p>
      </CardContent>
    </Card>
  )
}

function VersionInfo(props: VersionInfoProps) {
  const { info } = props
  const t = useTranslation()
  const locale = useLocale()
  const parts = [
    t('settings.update.currentVersion', { version: info?.currentVersion ?? '—' }),
    info ? t('settings.update.latestVersion', { version: info.latestVersion }) : null,
    info?.releaseDate ? t('settings.update.releasedAt', { date: formatDate(info.releaseDate, locale) }) : null,
  ].filter(Boolean)

  return <span>{parts.join(' · ')}</span>
}

function ReleaseNotes(props: ReleaseNotesProps) {
  const { info, hasUpdate } = props
  const t = useTranslation()
  const notes = hasUpdate ? info?.releaseNotes : undefined
  if (!notes) return null
  // GitHub Releases 的 release notes 是 HTML，需要用 dangerouslySetInnerHTML 渲染
  // 而非把标签当纯文本输出；渲染前用 DOMPurify 净化以防 XSS。
  const sanitizedNotes = DOMPurify.sanitize(notes)
  return (
    <details className="rounded-lg border border-module-border px-3 py-2 system-xs-regular">
      <summary className="cursor-pointer select-none system-xs-medium text-text-primary">
        {t('settings.update.notesToggle')}
      </summary>
      <div
        className="release-notes mt-2 max-h-48 overflow-y-auto system-2xs-regular text-text-tertiary"
        dangerouslySetInnerHTML={{ __html: sanitizedNotes }}
      />
    </details>
  )
}

function DownloadProgress(props: DownloadProgressProps) {
  const { progress } = props
  const t = useTranslation()
  if (progress == null) return null
  const percent = Math.round(progress * 100)
  return (
    <div className="grid gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="system-2xs-regular text-text-tertiary">{t('settings.update.downloading', { percent })}</p>
    </div>
  )
}

function UpdateActions(props: UpdateActionsProps) {
  const {
    status,
    hasUpdate,
    hasPreferredAsset,
    isMacOS,
    requiresManualUpdate,
    onDownload,
    onInstall,
    onOpenReleases,
  } = props
  const t = useTranslation()

  const renderUpdateAction = () => {
    if (!hasUpdate) return null
    if (isMacOS) {
      return (
        <Button size="sm" onClick={onOpenReleases}>
          <Download className="size-3.5" />
          {t('settings.update.downloadDmg')}
        </Button>
      )
    }
    // 跨大版本没有「下载更新」这条路：装了就是一次破坏性换代，只能用户自己去下载页。
    if (requiresManualUpdate) {
      return (
        <Button size="sm" onClick={onOpenReleases}>
          <Download className="size-3.5" />
          {t('settings.update.downloadNewVersion')}
        </Button>
      )
    }
    if (!hasPreferredAsset) {
      return (
        <Button size="sm" onClick={onOpenReleases}>
          <ExternalLink className="size-3.5" />
          {t('settings.update.githubReleases')}
        </Button>
      )
    }
    if (status === 'update-available') {
      return (
        <Button size="sm" onClick={onDownload}>
          <Download className="size-3.5" />
          {t('settings.update.download')}
        </Button>
      )
    }
    if (status === 'downloaded') {
      return (
        <Button size="sm" onClick={onInstall}>
          <Rocket className="size-3.5" />
          {t('settings.update.installNow')}
        </Button>
      )
    }
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {renderUpdateAction()}
      {(!isMacOS || !hasUpdate) && (
        <Button size="sm" variant="ghost" onClick={onOpenReleases}>
          <ExternalLink className="size-3.5" />
          {t('settings.update.githubReleases')}
        </Button>
      )}
    </div>
  )
}

export function UpdateCard() {
  const toast = useToast()
  const t = useTranslation()
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    info: null,
    errorMessage: null,
    downloadProgress: null,
    downloadedFile: null,
  })

  // 浏览器预览模式（VITE_PREVIEW_ONLY）下没有 preload 注入的 API
  const updater = getUpdater()

  /** 值没变时返回原对象，不让 React 重渲染。 */
  const applyState = useCallback((next: UpdateState) => {
    setState(current => (isSameState(current, next) ? current : next))
  }, [])

  const refresh = useCallback(async () => {
    if (!updater) return
    applyState(await updater.getState())
  }, [applyState, updater])

  useEffect(() => {
    if (!updater) return
    void refresh()
    return updater.onStateChanged(applyState)
  }, [applyState, refresh, updater])

  const handleCheck = async () => {
    if (!updater) return
    const next = await updater.check()
    applyState(next)
    if (next.status === 'up-to-date') {
      toast.success(t('settings.update.upToDateToast'))
    } else if (next.status === 'update-available') {
      toast.success(t('settings.update.availableToast', { version: next.info?.latestVersion ?? '' }))
    } else if (next.status === 'error') {
      toast.error(next.errorMessage ?? t('settings.update.checkFailed'))
    }
  }

  const handleDownload = async () => {
    if (!updater) return
    const result = await updater.download()
    if (result === 'failed') {
      toast.error(state.errorMessage ?? t('settings.update.downloadFailed'))
    } else if (result === 'download-complete') {
      toast.success(t('settings.update.downloadedToast'))
    }
    // 'downloading'：已经在下，重复点击不该再报一句话；
    // 'manual-download'：已经替用户打开了下载页，界面上的按钮本来就是「前往下载 DMG」。
  }

  const handleInstall = async () => {
    if (!updater) return
    try {
      await updater.install()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.update.installFailed'))
    }
  }

  const capabilities = getPlatformCapabilities()
  const handleOpenReleases = async () => {
    if (!updater) {
      capabilities.openExternal('https://github.com/yinxulai/osw/releases/latest')
      return
    }
    await updater.openReleases()
  }

  if (!updater) return <PreviewCard />

  const { status, info, errorMessage, downloadProgress } = state
  const isMacOS = capabilities.os === 'darwin'
  const isChecking = status === 'checking'
  const isDownloading = status === 'downloading'
  const hasUpdate = status === 'update-available' || status === 'downloading' || status === 'downloaded'

  return (
    <Card>
      <SettingsCardHeader
        icon={<Package />}
        title={t('settings.update.title')}
        description={isMacOS ? t('settings.update.descriptionMacOS') : t('settings.update.descriptionDesktop')}
        actions={<StatusBadge status={status} />}
      />
      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          <FormRow
            title={t('settings.update.version')}
            description={<VersionInfo info={info} />}
            control={(
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCheck}
                  disabled={isChecking}
                >
                  <RefreshCw className={isChecking ? 'animate-spin' : ''} />
                  {isChecking ? t('settings.update.checking') : t('settings.update.check')}
                </Button>
                <UpdateActions
                  status={status}
                  hasUpdate={hasUpdate}
                  hasPreferredAsset={Boolean(info?.preferredAsset)}
                  isMacOS={isMacOS}
                  requiresManualUpdate={Boolean(info?.requiresManualUpdate)}
                  onDownload={handleDownload}
                  onInstall={handleInstall}
                  onOpenReleases={handleOpenReleases}
                />
              </div>
            )}
          />

          {!isMacOS && info?.preferredAsset && !info.requiresManualUpdate && (
            <FormRow
              title={t('settings.update.package')}
              description={<span className="font-mono">{info.preferredAsset.name}</span>}
              control={<span className="system-xs-regular text-text-tertiary">{formatBytes(info.preferredAsset.size)}</span>}
            />
          )}
        </div>

        {(hasUpdate || errorMessage || isDownloading) && (
          <div className="grid gap-3 py-1">
            {info?.requiresManualUpdate && hasUpdate && (
              <p className="system-2xs-regular text-text-tertiary">
                {t('settings.update.manualUpdateNotice', { version: info.latestVersion })}
              </p>
            )}
            <ReleaseNotes info={info} hasUpdate={hasUpdate} />
            {errorMessage && (
              <p className="system-2xs-regular text-text-destructive">{errorMessage}</p>
            )}
            {isDownloading && <DownloadProgress progress={downloadProgress} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge(props: StatusBadgeProps) {
  const { status } = props
  const t = useTranslation()
  switch (status) {
    case 'checking':
      return <Badge variant="info">{t('settings.update.status.checking')}</Badge>
    case 'up-to-date':
      return <Badge variant="success">{t('settings.update.status.upToDate')}</Badge>
    case 'update-available':
      return <Badge variant="warning">{t('settings.update.status.available')}</Badge>
    case 'downloading':
      return <Badge variant="info">{t('settings.update.status.downloading')}</Badge>
    case 'downloaded':
      return <Badge variant="success">{t('settings.update.status.downloaded')}</Badge>
    case 'error':
      return <Badge variant="destructive">{t('settings.update.status.error')}</Badge>
    default:
      return <Badge variant="muted">{t('settings.update.status.idle')}</Badge>
  }
}
