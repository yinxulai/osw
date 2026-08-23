import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import type { Dispatch, SetStateAction } from 'react'
import type { ProviderModelRoute } from '@common/schemas'

type PriorityUpdate = { id: string; priority: number }

export function useModelReordering(selectedModels: ProviderModelRoute[], setModels: Dispatch<SetStateAction<ProviderModelRoute[]>>, reload: () => Promise<void>) {
  const toast = useToast()
  const mutation = useMutation({ mutationFn: (updates: PriorityUpdate[]) => Promise.all(updates.map(update => unwrap(providerModelApi.update(update.id, { logicalModelId: 'default', priority: update.priority })))), onError: async error => { toast.error(`模型顺序保存失败，已恢复服务端数据：${error.message}`); await reload() } })
  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = selectedModels.findIndex(model => model.id === active.id)
    const newIndex = selectedModels.findIndex(model => model.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const updates = arrayMove(selectedModels, oldIndex, newIndex).map((model, index) => ({ id: model.id, priority: index + 1 }))
    setModels(current => current.map(model => { const update = updates.find(item => item.id === model.id); return update ? { ...model, priority: update.priority } : model }))
    await mutation.mutateAsync(updates).catch(() => undefined)
  }, [mutation, selectedModels, setModels])
  return handleDragEnd
}
