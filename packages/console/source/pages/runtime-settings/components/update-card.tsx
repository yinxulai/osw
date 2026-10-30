import DOMPurify from 'dompurify'
import { Download, ExternalLink, Package, RefreshCw, Rocket } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatBytes } from '@/lib/format-bytes'
import { useUpdater } from '../hooks/use-updater'

type StatusBadgeProps = {
  status: UpdateCheckStatus
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
  const t = useTranslation()
  const { available, isMacOS, state, check, download, install, openReleases } = useUpdater()

  if (!available) return <PreviewCard />

  const { status, info, errorMessage, downloadProgress, checkPending } = state
  const isChecking = status === 'checking' || (checkPending && status === 'downloaded')
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
                  onClick={check}
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
                  onDownload={download}
                  onInstall={install}
                  onOpenReleases={openReleases}
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
