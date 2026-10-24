import { useEffect, useMemo, useState } from 'react'
import { Navigate } from '@tanstack/react-router'
import { KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useApiKeyRecency, useApiKeys, useApiKeysActions, useApiKeysError, useApiKeysLoading } from '@/data/api-keys'
import { useSettings } from '@/data/settings'
import { routePaths } from '@/routing/routes'
import { ApiKeyStats } from './components/api-key-stats'
import { ApiKeysTable } from './components/api-keys-table'
import { ApiKeyDialog } from './components/api-key-dialog'
import { ApiKeySecretDialog } from './components/api-key-secret-dialog'
import { apiKeyToDraft, draftExpiresTime, emptyApiKeyDraft, type ApiKeyDraft } from './lib/draft'
import { buildApiKeyRows } from './lib/rows'
import type { ApiKeyRow } from './types'

/**
 * 判定状态时的「现在」。
 *
 * 只取一次会在页面长期驻留后失真（过期的那把还显示为可用），所以放在 `useState` 里、
 * 由一分钟一次的定时器推进——粒度到分钟足够，也不值得为此建一条响应式依赖。
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function ApiKeysPage() {
  const t = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const now = useNow()

  const rawKeys = useApiKeys()
  const loading = useApiKeysLoading()
  const loadError = useApiKeysError()
  const actions = useApiKeysActions()
  const recency = useApiKeyRecency()
  const settings = useSettings()

  // 状态由「现在」推导，而不落库：过期是时间到了自动发生的事，不经过任何写操作。
  // 活跃度与 Key 列表来自两个库，拼接在 `lib/rows.ts` 里——它要处理「签发后一次都没用过」这个分支。
  const rows = useMemo(() => buildApiKeyRows(rawKeys, recency, now), [rawKeys, recency, now])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ApiKeyDraft>(emptyApiKeyDraft)

  // 明文只在创建 / 轮换后短暂持有，关闭弹窗即从内存里丢掉。
  const [secret, setSecret] = useState<{ name: string; value: string; rotated: boolean } | null>(null)

  const openCreate = () => {
    setEditingId(null)
    setDraft(emptyApiKeyDraft())
    setDialogOpen(true)
  }

  const openEdit = (key: ApiKeyRow) => {
    setEditingId(key.id)
    setDraft(apiKeyToDraft(key))
    setDialogOpen(true)
  }

  const submit = () => {
    const name = draft.name.trim()
    if (!name) return
    const expiresTime = draftExpiresTime(draft.expiresDate)
    void (async () => {
      try {
        if (editingId) {
          await actions.update.mutateAsync({ id: editingId, updates: { name, enabled: draft.enabled, expiresTime } })
          toast.success(t('apiKeys.saved'))
        } else {
          const created = await actions.create.mutateAsync({ name, enabled: draft.enabled, expiresTime })
          setSecret({ name, value: created.secret, rotated: false })
          toast.success(t('apiKeys.created'))
        }
        setDialogOpen(false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const toggle = (key: ApiKeyRow, enabled: boolean) => {
    void (async () => {
      try {
        await actions.update.mutateAsync({ id: key.id, updates: { enabled } })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const rotate = (key: ApiKeyRow) => {
    void (async () => {
      const confirmed = await confirm({
        title: t('apiKeys.rotate.title', { name: key.name }),
        description: t('apiKeys.rotate.description'),
        confirmLabel: t('apiKeys.rotate.confirm'),
      })
      if (!confirmed) return
      try {
        const rotated = await actions.rotate.mutateAsync(key.id)
        setSecret({ name: key.name, value: rotated.secret, rotated: true })
        toast.success(t('apiKeys.rotated'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const remove = (key: ApiKeyRow) => {
    void (async () => {
      const confirmed = await confirm({
        title: t('apiKeys.delete.title', { name: key.name }),
        description: t('apiKeys.delete.description'),
        confirmLabel: t('apiKeys.delete.confirm'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await actions.remove.mutateAsync(key.id)
        toast.success(t('apiKeys.deleted'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  // 模块被关掉后这个地址不该还能直接打开（侧栏入口已经收起，但书签和后退还在）。
  // 不报错、不留空页：静默送回统计分析，与「关掉 = 我没有这个功能」一致。
  if (settings && !settings.apiKeyFeatureEnabled) return <Navigate to={routePaths.overview} search={{ range: '7d' }} replace />

  return (
    <PageLayout>
      <PageHeader
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
        actions={<Button onClick={openCreate}><KeyRound />{t('apiKeys.create')}</Button>}
      />
      <PageContent>
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2 system-xs-regular text-text-tertiary">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
          <span className="min-w-0 flex-1">{t('apiKeys.notice')}</span>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{loadError}</span>
            <Button variant="outline" size="sm" onClick={actions.refresh}>{t('common.action.retry')}</Button>
          </div>
        )}

        {!loading && <ApiKeyStats keys={rows} />}

        {loading
          ? <div className="system-xs-regular text-text-tertiary">{t('apiKeys.loading')}</div>
          : (
            <ApiKeysTable
              keys={rows}
              now={now}
              onEdit={openEdit}
              onRotate={rotate}
              onDelete={remove}
              onToggle={toggle}
            />
          )}

        <ApiKeyDialog
          open={dialogOpen}
          editingId={editingId}
          draft={draft}
          saving={actions.create.isPending || actions.update.isPending}
          onChange={setDraft}
          onOpenChange={setDialogOpen}
          onSubmit={submit}
        />
        <ApiKeySecretDialog
          open={secret !== null}
          name={secret?.name ?? ''}
          secret={secret?.value ?? ''}
          rotated={secret?.rotated ?? false}
          onClose={() => setSecret(null)}
        />
      </PageContent>
    </PageLayout>
  )
}
