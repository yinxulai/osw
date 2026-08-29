import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import type { FetchedProviderModel } from '@/api/providers'

interface FetchedModelPickerProps {
  modelId: string
  multiSelect: boolean
  selectedModelIds: string[]
  fetchedModels: FetchedProviderModel[]
  modelSearch: string
  setModelSearch: (search: string) => void
  setModelId: (id: string) => void
  toggleModelSelection: (id: string, checked: boolean) => void
  filteredModels: FetchedProviderModel[]
}

export function FetchedModelPicker(props: FetchedModelPickerProps) {
  const {
    modelId,
    multiSelect,
    selectedModelIds,
    fetchedModels,
    modelSearch,
    setModelSearch,
    setModelId,
    toggleModelSelection,
    filteredModels,
  } = props

  if (fetchedModels.length === 0) return null

  return (
    <div className="mt-2 space-y-2 rounded-md border">
      <Input
        className="h-8 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
        value={modelSearch}
        onChange={event => setModelSearch(event.target.value)}
        placeholder={`搜索 ${fetchedModels.length} 个模型…`}
      />
      <div className="max-h-48 overflow-y-auto p-1">
        {filteredModels.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的模型</p>
        )}
        {filteredModels.map(model => (
          <button
            key={model.id}
            type="button"
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
              (multiSelect ? selectedModelIds.includes(model.id) : model.id === modelId) && 'bg-accent',
            )}
            onClick={() => {
              if (multiSelect) {
                const checked = selectedModelIds.includes(model.id)
                toggleModelSelection(model.id, !checked)
                return
              }
              setModelId(model.id)
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              {multiSelect && (
                <Checkbox
                  checked={selectedModelIds.includes(model.id)}
                  onCheckedChange={value => toggleModelSelection(model.id, value === true)}
                  onClick={event => event.stopPropagation()}
                  aria-label={`选择模型 ${model.id}`}
                />
              )}
              <span className="truncate font-mono">{model.id}</span>
            </div>
            {model.ownedBy && (
              <span className="shrink-0 text-[10px] text-muted-foreground">{model.ownedBy}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
