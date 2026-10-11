import { useMemo, useState } from 'react'
import { FolderPlus, LoaderCircle, Plug, Power, RefreshCcw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { PluginView } from '@common/plugin'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { usePlugins, usePluginsActions, usePluginsLoading } from '@/data/plugins'
import { useTranslation } from '@/i18n/provider'

export function PluginsPage() {
  const t = useTranslation()
  const plugins = usePlugins()
  const loading = usePluginsLoading()
  const { refresh, install, enable, disable, sync, reload, uninstall, setInputs } = usePluginsActions()
  const [installPath, setInstallPath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})

  const emptyDescription = useMemo(() => t('plugins.empty.description', { path: 'dataDir/plugins' }), [t])

  const handleInstall = async () => {
    if (!installPath.trim()) return
    try {
      setInstalling(true)
      await install({ type: 'directory', path: installPath.trim() })
      setInstallPath('')
    } finally {
      setInstalling(false)
    }
  }

  const updateDraft = (pluginKey: string, fieldKey: string, value: string) => {
    setDrafts(previous => ({
      ...previous,
      [pluginKey]: {
        ...(previous[pluginKey] ?? {}),
        [fieldKey]: value,
      },
    }))
  }

  const handleInputsSave = async (plugin: PluginView) => {
    const payload: Record<string, string> = {}
    for (const field of plugin.inputs) {
      const value = drafts[plugin.key]?.[field.key] ?? plugin.inputValues[field.key] ?? ''
      if (value.trim() !== '') payload[field.key] = value
    }
    if (Object.keys(payload).length === 0) return
    setBusyKey(plugin.key)
    try {
      await setInputs(plugin.key, payload)
    } finally {
      setBusyKey(null)
    }
  }

  const renderBody = () => {
    if (loading) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="p-4">
              <Skeleton className="mb-3 h-4 w-32" />
              <Skeleton className="mb-2 h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      )
    }

    if (plugins.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Plug}
            title={t('plugins.empty.title')}
            description={emptyDescription}
            action={
              <div className="flex w-full max-w-md gap-2">
                <input
                  value={installPath}
                  onChange={event => setInstallPath(event.target.value)}
                  placeholder={t('plugins.install.placeholder')}
                  className="flex-1 rounded-md border border-module-border bg-background px-3 py-2 text-sm text-text-primary outline-none ring-0"
                />
                <Button onClick={() => void handleInstall()} disabled={installing || !installPath.trim()}>
                  {installing ? <LoaderCircle className="animate-spin" /> : <FolderPlus size={14} />}
                  {t('plugins.install.submit')}
                </Button>
              </div>
            }
          />
        </Card>
      )
    }

    return (
      <div className="space-y-3">
        <Card className="p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="system-sm-medium text-text-primary">{t('plugins.install.title')}</p>
              <p className="system-xs-regular text-text-tertiary">{t('plugins.install.hint')}</p>
            </div>
            <div className="flex gap-2">
              <input
                value={installPath}
                onChange={event => setInstallPath(event.target.value)}
                placeholder={t('plugins.install.placeholder')}
                className="w-full min-w-0 max-w-md rounded-md border border-module-border bg-background px-3 py-2 text-sm text-text-primary outline-none ring-0 md:w-80"
              />
              <Button onClick={() => void handleInstall()} disabled={installing || !installPath.trim()}>
                {installing ? <LoaderCircle className="animate-spin" /> : <FolderPlus size={14} />}
                {t('plugins.install.submit')}
              </Button>
            </div>
          </div>
        </Card>

        {plugins.map(plugin => (
          <Card key={plugin.key} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="system-md-semibold text-text-primary">{plugin.name || plugin.key}</h3>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs ${plugin.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-muted bg-muted text-text-tertiary'}`}>
                    {plugin.enabled ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                    {plugin.enabled ? t('plugins.enabled') : t('plugins.disabled')}
                  </span>
                </div>
                <p className="mt-1 system-sm-regular text-text-tertiary">{plugin.description || plugin.key}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {plugin.enabled ? (
                  <Button variant="outline" size="sm" onClick={() => void disable(plugin.key)} disabled={busyKey === plugin.key}>
                    <Power size={14} /> {t('plugins.disable')}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void enable(plugin.key)} disabled={busyKey === plugin.key}>
                    <Power size={14} /> {t('plugins.enable')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void sync(plugin.key)} disabled={busyKey === plugin.key}>
                  <RefreshCcw size={14} /> {t('plugins.sync')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void reload(plugin.key)} disabled={busyKey === plugin.key}>
                  <RefreshCcw size={14} /> {t('plugins.reload')}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void uninstall(plugin.key)}>
                  <Trash2 size={14} /> {t('plugins.uninstall')}
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm text-text-secondary md:grid-cols-3">
              <div>
                <div className="system-2xs-medium uppercase tracking-[0.08em] text-text-tertiary">{t('plugins.meta.provider')}</div>
                <div className="mt-1">{plugin.providerName || plugin.key}</div>
              </div>
              <div>
                <div className="system-2xs-medium uppercase tracking-[0.08em] text-text-tertiary">{t('plugins.meta.models')}</div>
                <div className="mt-1">{plugin.modelCount}</div>
              </div>
              <div>
                <div className="system-2xs-medium uppercase tracking-[0.08em] text-text-tertiary">{t('plugins.meta.status')}</div>
                <div className="mt-1">{plugin.credentialStatus}</div>
              </div>
            </div>

            {plugin.error && (
              <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
                {plugin.error}
              </div>
            )}

            {plugin.inputs.length > 0 && (
              <div className="mt-4 space-y-3 rounded-md border border-module-border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="system-sm-medium text-text-primary">{t('plugins.inputs.title')}</h4>
                  <Button size="sm" variant="outline" onClick={() => void handleInputsSave(plugin)} disabled={busyKey === plugin.key}>
                    {t('plugins.inputs.save')}
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {plugin.inputs.map(field => {
                    const value = drafts[plugin.key]?.[field.key] ?? plugin.inputValues[field.key] ?? ''
                    return (
                      <label key={field.key} className="space-y-1.5">
                        <span className="system-xs-medium text-text-secondary">{field.label}</span>
                        <input
                          value={value}
                          type={field.secret ? 'password' : 'text'}
                          onChange={event => updateDraft(plugin.key, field.key, event.target.value)}
                          placeholder={field.placeholder ?? field.label}
                          className="w-full rounded-md border border-module-border bg-background px-3 py-2 text-sm text-text-primary outline-none ring-0"
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    )
  }

  return (
    <PageLayout>
      <PageHeader
        title={t('plugins.title')}
        description={t('plugins.description')}
        actions={
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCcw size={14} /> {t('common.action.refresh')}
          </Button>
        }
      />
      <PageContent className="pb-5">{renderBody()}</PageContent>
    </PageLayout>
  )
}
