import { useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  appendProviderModelBindings,
  filterCandidates,
  groupCandidatesByProvider,
  loadProviderModelCandidates,
  type ProviderModelCandidate,
} from '../lib/provider-model-candidates'

interface AddProviderModelDialogProps {
  open: boolean
  /** 加到哪个逻辑模型上。这里是**数据记录 id**（`lm_*`）：绑定的外键指着它。 */
  logicalModelRecordId: string
  /** 当前已经绑了几条：新绑定要接在它们后面，所以这个数是调用方的现状。 */
  existingBindingCount: number
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}

/**
 * 往逻辑模型里追加供应商模型的对话框。
 *
 * 候选怎么算、优先级怎么排全在 `lib/provider-model-candidates` 里；这里只剩下「哪些被
 * 勾上了」和「按供应商分组画出来」。
 */
export function AddProviderModelDialog(props: AddProviderModelDialogProps) {
  const { open, logicalModelRecordId, existingBindingCount, onOpenChange, onAdded } = props
  const toast = useToast()
  const t = useTranslation()
  const [candidates, setCandidates] = useState<ProviderModelCandidate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const modelGroups = useMemo(() => groupCandidatesByProvider(candidates), [candidates])
  const visibleGroups = useMemo(() => filterCandidates(modelGroups, search), [modelGroups, search])
  const selectedModels = candidates.filter(model => selectedIds.includes(model.id))

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void loadProviderModelCandidates(logicalModelRecordId)
      .then(next => {
        if (cancelled) return
        setCandidates(next)
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
      await appendProviderModelBindings(logicalModelRecordId, selectedIds, existingBindingCount)
      toast.success(t('logicalModels.addModels.added', { count: selectedIds.length }))
      onAdded()
      onOpenChange(false)
      setSelectedIds([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logicalModels.addModels.title')}</DialogTitle>
          <DialogDescription>{t('logicalModels.addModels.description')}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="system-sm-regular text-text-tertiary">{t('logicalModels.addModels.loading')}</p> : candidates.length === 0 ? <p className="system-sm-regular text-text-tertiary">{t('logicalModels.addModels.none')}</p> : (
          <div className="flex min-h-0 flex-col gap-2">
            <Command shouldFilter={false} className="min-h-0 rounded-lg border border-module-border bg-workflow-block-parma-bg p-0">
              <CommandInput className="px-2" placeholder={t('logicalModels.addModels.searchPlaceholder')} value={search} onValueChange={setSearch} />
              <CommandList className="max-h-64 px-1 pb-1">
                <CommandEmpty>{t('logicalModels.addModels.noMatch')}</CommandEmpty>
                {visibleGroups.map(([providerName, providerModels]) => (
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
