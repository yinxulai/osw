import { useEffect, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { Download, ExternalLink, Package, RefreshCw, Rocket } from 'lucide-react'
import { SettingsCardHeader } from './settings-card-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

type StatusBadgeProps = {
  status: UpdateCheckStatus
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
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
  return (
    <Card>
      <SettingsCardHeader
        icon={<Package />}
        title="版本更新"
        description="通过 GitHub Releases 获取应用更新"
      />
      <CardContent className="px-4 py-4">
        <p className="text-[11px] text-muted-foreground">
          版本更新功能仅在 Electron 桌面端可用。
        </p>
      </CardContent>
    </Card>
  )
}

function VersionInfo(props: VersionInfoProps) {
  const { info } = props
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="text-muted-foreground">
        当前版本：<span className="font-medium text-foreground">v{info?.currentVersion ?? '—'}</span>
      </span>
      {info && (
        <span className="text-muted-foreground">
          最新版本：<span className="font-medium text-foreground">v{info.latestVersion}</span>
        </span>
      )}
      {info?.releaseDate && (
        <span className="text-muted-foreground">
          发布时间：{formatDate(info.releaseDate)}
        </span>
      )}
    </div>
  )
}

function ReleaseNotes(props: ReleaseNotesProps) {
  const { info, hasUpdate } = props
  const notes = hasUpdate ? info?.releaseNotes : undefined
  if (!notes) return null
  // GitHub Releases 的 release notes 是 HTML，需要用 dangerouslySetInnerHTML 渲染
  // 而非把标签当纯文本输出；渲染前用 DOMPurify 净化以防 XSS。
  const sanitizedNotes = DOMPurify.sanitize(notes)
  return (
    <details className="rounded-md bg-muted/50 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium text-foreground">
        查看更新说明
      </summary>
      <div
        className="release-notes mt-2 max-h-48 overflow-y-auto rounded-sm text-[11px] leading-relaxed text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizedNotes }}
      />
    </details>
  )
}

function DownloadProgress(props: DownloadProgressProps) {
  const { progress } = props
  if (progress == null) return null
  const percent = Math.round(progress * 100)
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">正在下载… {percent}%</p>
    </div>
  )
}

function UpdateActions(props: UpdateActionsProps) {
  const {
    status,
    hasUpdate,
    hasPreferredAsset,
    isMacOS,
    onDownload,
    onInstall,
    onOpenReleases,
  } = props

  const renderUpdateAction = () => {
    if (!hasUpdate) return null
    if (isMacOS) {
      return (
        <Button size="sm" onClick={onOpenReleases}>
          <Download className="mr-1 h-3.5 w-3.5" />
          前往下载 DMG
        </Button>
      )
    }
    if (!hasPreferredAsset) {
      return (
        <Button size="sm" onClick={onOpenReleases}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          前往发布页
        </Button>
      )
    }
    if (status === 'update-available') {
      return (
        <Button size="sm" onClick={onDownload}>
          <Download className="mr-1 h-3.5 w-3.5" />
          下载更新
        </Button>
      )
    }
    if (status === 'downloaded') {
      return (
        <Button size="sm" onClick={onInstall}>
          <Rocket className="mr-1 h-3.5 w-3.5" />
          立即安装
        </Button>
      )
    }
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {renderUpdateAction()}
      {(!isMacOS || !hasUpdate) && (
        <Button size="sm" variant="ghost" onClick={onOpenReleases}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          GitHub 发布页
        </Button>
      )}
    </div>
  )
}

export function UpdateCard() {
  const toast = useToast()
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    info: null,
    errorMessage: null,
    downloadProgress: null,
    downloadedFile: null,
  })

  // 浏览器预览模式（VITE_PREVIEW_ONLY）下没有 preload 注入的 API
  const updater = typeof window !== 'undefined' ? window.electronAPI?.updater : undefined

  const refresh = useCallback(async () => {
    if (!updater) return
    const next = await updater.getState()
    setState(next)
  }, [updater])

  useEffect(() => {
    if (!updater) return
    void refresh()
    const unsubscribe = updater.onStateChanged(setState)
    return unsubscribe
  }, [refresh, updater])

  const handleCheck = async () => {
    if (!updater) return
    const next = await updater.check()
    setState(next)
    if (next.status === 'up-to-date') {
      toast.success('已是最新版本')
    } else if (next.status === 'update-available') {
      toast.success(`发现新版本 v${next.info?.latestVersion}`)
    } else if (next.status === 'error') {
      toast.error(next.errorMessage ?? '检查更新失败')
    }
  }

  const handleDownload = async () => {
    if (!updater) return
    const ok = await updater.download()
    if (!ok) {
      toast.error(state.errorMessage ?? '下载失败')
    } else {
      toast.success('安装包已下载完成')
    }
  }

  const handleInstall = async () => {
    if (!updater) return
    try {
      await updater.install()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动安装程序失败')
    }
  }

  const handleOpenReleases = async () => {
    if (!updater) {
      window.open('https://github.com/yinxulai/one-switch/releases/latest', '_blank')
      return
    }
    await updater.openReleases()
  }

  if (!updater) return <PreviewCard />

  const { status, info, errorMessage, downloadProgress } = state
  const isMacOS = window.electronAPI.platform === 'darwin'
  const isChecking = status === 'checking'
  const isDownloading = status === 'downloading'
  const hasUpdate = status === 'update-available' || status === 'downloading' || status === 'downloaded'

  return (
    <Card>
      <SettingsCardHeader
        icon={<Package />}
        title="版本更新"
        description={isMacOS ? '检查新版本并下载 DMG 安装包' : '检查新版本并通过系统安装程序升级'}
        actions={<StatusBadge status={status} />}
      />
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <VersionInfo info={info} />
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheck}
            disabled={isChecking}
          >
            <RefreshCw className={isChecking ? 'animate-spin' : ''} />
            {isChecking ? '检查中…' : '检查更新'}
          </Button>
        </div>

        {!isMacOS && info?.preferredAsset && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{info.preferredAsset.name}</span>
              <span>{formatBytes(info.preferredAsset.size)}</span>
            </div>
          </div>
        )}

        <ReleaseNotes info={info} hasUpdate={hasUpdate} />

        {errorMessage && (
          <p className="text-[11px] text-destructive">{errorMessage}</p>
        )}

        {isDownloading && <DownloadProgress progress={downloadProgress} />}

        <UpdateActions
          status={status}
          hasUpdate={hasUpdate}
          hasPreferredAsset={Boolean(info?.preferredAsset)}
          isMacOS={isMacOS}
          onDownload={handleDownload}
          onInstall={handleInstall}
          onOpenReleases={handleOpenReleases}
        />
      </CardContent>
    </Card>
  )
}

function StatusBadge(props: StatusBadgeProps) {
  const { status } = props
  switch (status) {
    case 'checking':
      return <Badge variant="info">检查中</Badge>
    case 'up-to-date':
      return <Badge variant="success">最新</Badge>
    case 'update-available':
      return <Badge variant="warning">可更新</Badge>
    case 'downloading':
      return <Badge variant="info">下载中</Badge>
    case 'downloaded':
      return <Badge variant="success">待安装</Badge>
    case 'error':
      return <Badge variant="destructive">检查失败</Badge>
    default:
      return <Badge variant="muted">未检查</Badge>
  }
}
