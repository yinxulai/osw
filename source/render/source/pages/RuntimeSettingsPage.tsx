import { useEffect, useState } from 'react'
import type { Settings } from '@common/schemas'
import { proxyApi, settingsApi, type ProxyServerStatus } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

export default function RuntimeSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [saved, setSaved] = useState(false)

  const loadData = async () => {
    setLoading(true)
    const [settingsResult, statusResult] = await Promise.all([settingsApi.get(), proxyApi.status()])
    if (!settingsResult.success || !statusResult.success) {
      setErrorMessage(!settingsResult.success ? settingsResult.errorMessage : !statusResult.success ? statusResult.errorMessage : '加载失败')
      setLoading(false)
      return
    }
    setSettings(settingsResult.data)
    setProxyStatus(statusResult.data)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    setSaved(false)
    setErrorMessage('')
    const updateResult = await settingsApi.update({
      listenHost: settings.listenHost,
      listenPort: settings.listenPort,
      logRetentionCount: settings.logRetentionCount,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
    })
    if (!updateResult.success) {
      setSaving(false)
      setErrorMessage(updateResult.errorMessage)
      return
    }
    const restartResult = await proxyApi.restart()
    setSaving(false)
    if (!restartResult.success) {
      setErrorMessage(`设置已保存，但代理重启失败：${restartResult.errorMessage}`)
      return
    }
    setSettings(updateResult.data)
    setProxyStatus(restartResult.data)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <PageLayout>
      <PageHeader title="设置" description="配置代理监听地址、故障转移和本地日志容量" />
      <PageContent>
        {errorMessage && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
        {loading || !settings ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">正在加载设置...</Card>
        ) : (
          <>
            <Card>
              <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div><CardTitle>监听配置</CardTitle><CardDescription className="mt-1">修改后保存会自动重启代理服务</CardDescription></div>
                <Badge variant={proxyStatus?.running ? 'success' : 'muted'}>{proxyStatus?.running ? '运行中' : '已停止'}</Badge>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="listen-host" className="text-xs">监听地址</Label><Input id="listen-host" className="h-8 font-mono text-xs" value={settings.listenHost} onChange={event => setSettings({ ...settings, listenHost: event.target.value })} placeholder="例如：127.0.0.1" /><p className="text-[11px] text-muted-foreground">建议保留 127.0.0.1，仅允许本机访问。</p></div>
                <div className="space-y-1.5"><Label htmlFor="listen-port" className="text-xs">监听端口</Label><Input id="listen-port" type="number" min={1} max={65535} className="h-8 text-xs" value={settings.listenPort} onChange={event => setSettings({ ...settings, listenPort: Number(event.target.value) })} placeholder="例如：9300" /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle>故障转移</CardTitle><CardDescription>这些设置对后续请求生效</CardDescription></CardHeader>
              <CardContent className="grid gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5"><Label htmlFor="failure-threshold" className="text-xs">连续失败阈值</Label><Input id="failure-threshold" type="number" min={1} className="h-8 text-xs" value={settings.consecutiveFailureThreshold} onChange={event => setSettings({ ...settings, consecutiveFailureThreshold: Number(event.target.value) })} placeholder="例如：3" /></div>
                <div className="space-y-1.5"><Label htmlFor="cooldown-base" className="text-xs">初始冷却（秒）</Label><Input id="cooldown-base" type="number" min={1} className="h-8 text-xs" value={settings.cooldownBaseSeconds} onChange={event => setSettings({ ...settings, cooldownBaseSeconds: Number(event.target.value) })} placeholder="例如：30" /></div>
                <div className="space-y-1.5"><Label htmlFor="cooldown-max" className="text-xs">最大冷却（秒）</Label><Input id="cooldown-max" type="number" min={1} className="h-8 text-xs" value={settings.cooldownMaxSeconds} onChange={event => setSettings({ ...settings, cooldownMaxSeconds: Number(event.target.value) })} placeholder="例如：300" /></div>
                <div className="space-y-1.5"><Label htmlFor="idle-timeout" className="text-xs">流式空闲超时（毫秒）</Label><Input id="idle-timeout" type="number" min={1} className="h-8 text-xs" value={settings.idleTimeoutMilliseconds} onChange={event => setSettings({ ...settings, idleTimeoutMilliseconds: Number(event.target.value) })} placeholder="例如：30000" /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle>请求日志容量</CardTitle><CardDescription>只记录元数据和故障尝试，不保存请求体、响应体或 API Key</CardDescription></CardHeader>
              <CardContent className="pt-0"><div className="max-w-sm space-y-1.5"><Label htmlFor="log-retention" className="text-xs">最多保留条数</Label><Input id="log-retention" type="number" min={1} className="h-8 text-xs" value={settings.logRetentionCount} onChange={event => setSettings({ ...settings, logRetentionCount: Number(event.target.value) })} placeholder="例如：10000" /></div></CardContent>
            </Card>

            <div className="flex justify-end"><Button className="h-8 px-3 text-xs" disabled={saving} onClick={() => void saveSettings()}>{saving ? '保存并重启中...' : saved ? '已保存' : '保存并重启代理'}</Button></div>
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
