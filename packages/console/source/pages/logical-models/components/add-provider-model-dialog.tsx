import { useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { providerApi } from '@/api/providers'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

type ProviderModelOption = { id: string; providerId: string; providerName: string; modelName: string }

interface AddProviderModelDialogProps {
  open: boolean
  /** 加到哪个逻辑模型上。这里是**数据记录 id**（`lm_*`）：绑定的外键指着它。 */
  logicalModelRecordId: string
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}

export function AddProviderModelDialog(props: AddProviderModelDialogProps) {
  const { open, logicalModelRecordId, onOpenChange, onAdded } = props
  const toast = useToast()
  const t = useTranslation()
  const [models, setModels] = useState<ProviderModelOption[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ProviderModelOption[]>()
    for (const model of models) {
      const group = groups.get(model.providerName) ?? []
      group.push(model)
      groups.set(model.providerName, group)
    }
    return [...groups.entries()]
  }, [models])

  const selectedModels = models.filter(model => selectedIds.includes(model.id))
  const filteredModelGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return modelGroups
    return modelGroups
      .map(([providerName, providerModels]) => [providerName, providerModels.filter(model => `${providerName} ${model.modelName} ${model.id}`.toLowerCase().includes(query))] as const)
      .filter(([, providerModels]) => providerModels.length > 0)
  }, [modelGroups, search])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void Promise.all([unwrap(providerApi.list()), unwrap(providerModelApi.list()), unwrap(schedulingPolicyApi.list(logicalModelRecordId))])
      .then(([providersResult, modelsResult, policiesResult]) => {
        if (cancelled) return
        const providerNameById = new Map(providersResult.map(provider => [provider.id, provider.name]))
        const policies = new Set(policiesResult.map(policy => policy.providerModelId))
        // 全局停用的模型不进候选：加了也只能是一条关着的绑定，服务端也会拒绝为它打开绑定。
        setModels(modelsResult
          .filter(model => model.deletedTime === null && model.enabled && !policies.has(model.id))
          .map(model => ({ id: model.id, providerId: model.providerId, providerName: providerNameById.get(model.providerId) ?? model.providerId, modelName: model.modelName })))
        setSelectedIds([])
        setSearch('')
      })
      .catch(error => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [logicalModelRecordId, open, toast])

  const addModels = async () => {
    if (selectedIds.length === 0) return
    setSaving(true)
    try {
      await Promise.all(selectedIds.map((providerModelId, index) => unwrap(schedulingPolicyApi.update({ logicalModelId: logicalModelRecordId, providerModelId, priority: models.length + index + 1, enabled: true }))))
      toast.success(t('logicalModels.addModels.added', { count: selectedIds.length }))
      onAdded()
      onOpenChange(false)
      setSelectedIds([])
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logicalModels.addModels.title')}</DialogTitle>
          <DialogDescription>{t('logicalModels.addModels.description')}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="system-sm-regular text-text-tertiary">{t('logicalModels.addModels.loading')}</p> : models.length === 0 ? <p className="system-sm-regular text-text-tertiary">{t('logicalModels.addModels.none')}</p> : (
          <div className="flex min-h-0 flex-col gap-2">
            <Command shouldFilter={false} className="min-h-0 rounded-lg border border-module-border bg-workflow-block-parma-bg p-0">
              <CommandInput className="px-2" placeholder={t('logicalModels.addModels.searchPlaceholder')} value={search} onValueChange={setSearch} />
              <CommandList className="max-h-64 px-1 pb-1">
                <CommandEmpty>{t('logicalModels.addModels.noMatch')}</CommandEmpty>
                {filteredModelGroups.map(([providerName, providerModels]) => (
                  <CommandGroup key={providerName} heading={providerName} className="p-1">
                    {providerModels.map(model => (
                      <CommandItem key={model.id} value={model.id} className="min-h-9" onSelect={() => setSelectedIds(current => current.includes(model.id) ? current.filter(id => id !== model.id) : [...current, model.id])}>
                        <span className="min-w-0 flex-1 truncate">{model.modelName}</span>
                        <Check className={`size-4 shrink-0 ${selectedIds.includes(model.id) ? 'opacity-100' : 'opacity-0'}`} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
            <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-module-border bg-inset px-2 py-1.5">
              {selectedModels.length === 0 ? <span className="system-xs-regular text-text-tertiary">{t('logicalModels.addModels.pickHint')}</span> : selectedModels.map(model => (
                <button key={model.id} type="button" className="inline-flex max-w-full items-center gap-1 rounded-lg bg-card px-2 py-1 system-xs-regular text-text-primary" onClick={() => setSelectedIds(current => current.filter(id => id !== model.id))}>
                  <span className="max-w-48 truncate">{model.modelName}</span>
                  <X className="size-3.5 shrink-0 text-text-quaternary" />
                </button>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.action.cancel')}</Button>
          <Button disabled={selectedIds.length === 0 || saving || loading} onClick={() => void addModels()}>{saving ? t('logicalModels.addModels.adding') : selectedIds.length > 0 ? t('logicalModels.addModels.submitCount', { count: selectedIds.length }) : t('logicalModels.addModels.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
