import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { schedulingPolicyApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import { buildQueueUnits, flattenUnits } from '../lib/queue-groups'

export function useQueueInteractions(models: ProviderModelRoute[], providers: Record<string, Provider>, updateModels: (update: (models: ProviderModelRoute[]) => ProviderModelRoute[]) => void, loadModels: () => Promise<boolean>, proxyBaseUrl: string) {
  const toast = useToast()
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

    // 以"队列单元"（单模型 / 供应商分组）为粒度排序，再展开为扁平模型列表
    const units = buildQueueUnits(models, providers)
    const oldIndex = units.findIndex(unit => unit.id === active.id)
    const newIndex = units.findIndex(unit => unit.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = flattenUnits(arrayMove(units, oldIndex, newIndex))
      .map((model, index) => ({ ...model, priority: index + 1 }))
    updateModels(() => reordered)
    const results = await Promise.all(reordered.map(model => schedulingPolicyApi.update({
      logicalModelId: 'default',
      providerModelId: model.id,
      priority: model.priority,
    })))
    if (results.some(result => !result.success)) {
      toast.error('队列顺序保存失败，已恢复服务端数据')
      await loadModels()
    }
  }, [loadModels, models, providers, toast, updateModels])

  return { copied, copyEndpoint, handleDragEnd }
}
