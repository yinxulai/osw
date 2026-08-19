import { useEffect, useState, useCallback } from 'react'
import { Download, ExternalLink, Package, RefreshCw, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

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
    const file = await updater.download()
    if (!file) {
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

  if (!updater) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            版本更新
          </CardTitle>
          <CardDescription>
            基于 GitHub Releases 检查新版本，下载后由系统安装程序完成升级
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[11px] text-muted-foreground">
            版本更新功能仅在 Electron 桌面端可用。
          </p>
        </CardContent>
      </Card>
    )
  }

  const { status, info, errorMessage, downloadProgress } = state
  const isChecking = status === 'checking'
  const isDownloading = status === 'downloading'
  const hasUpdate = status === 'update-available' || status === 'downloading' || status === 'downloaded'
  const currentVersion = info?.currentVersion ?? '—'
  const percent = downloadProgress != null ? Math.round(downloadProgress * 100) : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              版本更新
            </CardTitle>
            <CardDescription>
              基于 GitHub Releases 检查新版本，下载后由系统安装程序完成升级
            </CardDescription>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            当前版本：<span className="font-medium text-foreground">v{currentVersion}</span>
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

        {info?.preferredAsset && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{info.preferredAsset.name}</span>
              <span>{formatBytes(info.preferredAsset.size)}</span>
            </div>
          </div>
        )}

        {info?.releaseNotes && hasUpdate && (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-foreground">
              查看更新说明
            </summary>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-muted-foreground">
              {info.releaseNotes}
            </pre>
          </details>
        )}

        {errorMessage && (
          <p className="text-[11px] text-destructive">{errorMessage}</p>
        )}

        {isDownloading && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">正在下载… {percent}%</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status === 'idle' || status === 'up-to-date' || status === 'error' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleCheck}
              disabled={isChecking}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? '检查中…' : '检查更新'}
            </Button>
          ) : null}

          {hasUpdate && info?.preferredAsset && (
            <>
              {status === 'update-available' && (
                <Button size="sm" onClick={handleDownload}>
                  <Download className="mr-1 h-3.5 w-3.5" />
                  下载更新
                </Button>
              )}
              {status === 'downloaded' && (
                <Button size="sm" onClick={handleInstall}>
                  <Rocket className="mr-1 h-3.5 w-3.5" />
                  立即安装
                </Button>
              )}
            </>
          )}

          {hasUpdate && !info?.preferredAsset && (
            <Button size="sm" onClick={handleOpenReleases}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              前往发布页
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={handleOpenReleases}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            GitHub 发布页
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: UpdateCheckStatus }) {
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
