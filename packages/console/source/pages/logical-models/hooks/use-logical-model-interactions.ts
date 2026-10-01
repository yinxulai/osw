import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { schedulingPolicyApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import type { LogicalModelProviderModel } from '@common/schemas'

export function useLogicalModelInteractions(logicalModelRecordId: string, models: LogicalModelProviderModel[], updateModels: (update: (models: LogicalModelProviderModel[]) => LogicalModelProviderModel[]) => void, loadModels: () => Promise<boolean>, proxyBaseUrl: string) {
  const toast = useToast()
  const t = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const copyEndpoint = useCallback(async (url?: string) => {
    await navigator.clipboard.writeText(url ?? proxyBaseUrl)
    setCopied(true)
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
  }, [proxyBaseUrl])

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = models.findIndex(model => model.id === active.id)
    const newIndex = models.findIndex(model => model.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(models, oldIndex, newIndex)
      .map((model, index) => ({ ...model, priority: index + 1 }))
    updateModels(() => reordered)
    const results = await Promise.all(reordered.map(model => schedulingPolicyApi.update({
      logicalModelId: logicalModelRecordId,
      providerModelId: model.id,
      priority: model.priority,
    })))
    if (results.some(result => !result.success)) {
      toast.error(t('logicalModels.interactions.reorderFailed'))
      await loadModels()
    }
  }, [loadModels, logicalModelRecordId, models, t, toast, updateModels])

  return { copied, copyEndpoint, handleDragEnd }
}
