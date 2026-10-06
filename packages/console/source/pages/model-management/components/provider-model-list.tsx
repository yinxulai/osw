import { useEffect, useMemo, useState } from 'react'
import { Ban, Plus, Server, Trash2 } from 'lucide-react'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/provider'
import { ProviderModelRow } from './provider-model-row'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderModelListProps {
  provider: Provider
  models: ProviderModelRoute[]
  onAddModel: () => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
  onRemoveModels: (models: ProviderModelRoute[]) => Promise<boolean>
  onDisableModels: (models: ProviderModelRoute[]) => Promise<boolean>
}

export function ProviderModelList(props: ProviderModelListProps) {
  const { models, onAddModel, onEditModel, onToggleModelEnabled, onRemoveModel, onRemoveModels, onDisableModels } = props
  const t = useTranslation()
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')

  // 模型列表变化后清掉已经不存在的选中项。
  // `filter` 永远返回新数组：即使一条都没被剔掉，写入的也是一个新引用，照样触发一次重渲染。
  // 父级只要重建一次 `models`（对象引用不稳定时很常见）就会白跑一轮，所以先比长度再决定要不要写。
  useEffect(() => {
    const modelIdSet = new Set(models.map(model => model.id))
    setSelectedModelIds(current => {
      const next = current.filter(id => modelIdSet.has(id))
      return next.length === current.length ? current : next
    })
  }, [models])

  const selectedCount = selectedModelIds.length
  const selectedSet = useMemo(() => new Set(selectedModelIds), [selectedModelIds])
  const searchKeyword = modelSearch.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    if (!searchKeyword) return models
    return models.filter(model => model.modelName.toLowerCase().includes(searchKeyword))
  }, [models, searchKeyword])

  const removeSelected = async () => {
    const selectedModels = models.filter(model => selectedSet.has(model.id))
    if (selectedModels.length === 0) return
    const removed = await onRemoveModels(selectedModels)
    if (removed) setSelectedModelIds([])
  }

  const disableSelected = async () => {
    const selectedModels = models.filter(model => selectedSet.has(model.id))
    if (selectedModels.length === 0) return
    const disabled = await onDisableModels(selectedModels)
    if (disabled) setSelectedModelIds([])
  }

  return (
    <>
      <div className="pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-2">
            <Input
              placeholder={t('models.list.searchPlaceholder')}
              value={modelSearch}
              onChange={event => setModelSearch(event.target.value)}
              aria-label={t('models.list.searchAria')}
            />
          </div>
          {selectedCount > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="system-2xs-regular text-text-tertiary">{t('models.list.selectedCount', { count: selectedCount })}</span>
              <Button variant="outline" size="sm" onClick={() => void disableSelected()}>
                <Ban size={13} /> {t('models.list.disable')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void removeSelected()}>
                <Trash2 size={13} /> {t('common.action.delete')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={onAddModel}>
              <Plus size={13} /> {t('models.dialog.submit')}
            </Button>
          )}
        </div>
      </div>
      {models.length ? (
        // 模型不分先后：顺序由逻辑模型页的调度绑定（`scheduling_policies.priority`）决定，
        // `provider_models` 表没有排序列。这里不摆拖拽，避免一个拖了就报错、又不落地的入口。
        <div className="overflow-hidden rounded-lg border border-module-border bg-workflow-block-parma-bg divide-y divide-border/50">
          {visibleModels.map(model => (
            <ProviderModelRow
              key={model.id}
              model={model}
              selected={selectedSet.has(model.id)}
              onSelectedChange={checked => {
                setSelectedModelIds(current => checked
                  ? current.includes(model.id) ? current : [...current, model.id]
                  : current.filter(id => id !== model.id))
              }}
              onEditModel={onEditModel}
              onToggleModelEnabled={onToggleModelEnabled}
              onRemoveModel={onRemoveModel}
            />
          ))}
          {visibleModels.length === 0 && (
            <InlineEmptyState title={t('models.picker.empty')} className="px-3 py-6" />
          )}
        </div>
      ) : (
        <InlineEmptyState
          icon={Server}
          title={t('models.list.emptyTitle')}
          description={t('models.list.emptyDescription')}
          className="min-h-36 justify-center rounded-lg border border-module-border bg-inset"
        />
      )}
    </>
  )
}
