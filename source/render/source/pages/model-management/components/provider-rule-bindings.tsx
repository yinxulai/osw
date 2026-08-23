import { useEffect, useState } from 'react'
import { GripVertical, Plus, ScrollText, Trash2 } from 'lucide-react'
import { modificationRuleApi, providerModelApi } from '@/api/models'
import type { ModificationRule } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface BoundRule { id: string; name: string; stage: 'request' | 'response'; enabled: boolean }

export function ProviderRuleBindings({ providerModelId }: { providerModelId: string }) {
  const [availableRules, setAvailableRules] = useState<ModificationRule[]>([])
  const [rules, setRules] = useState<BoundRule[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState('')
  useEffect(() => { void Promise.all([modificationRuleApi.list(), providerModelApi.modificationRules(providerModelId)]).then(([allResponse, bindingsResponse]) => { if (!allResponse.success || !bindingsResponse.success) return; const all = allResponse.data; const bindings = bindingsResponse.data; setAvailableRules(all); setRules(bindings.map(binding => { const rule = all.find(item => item.id === binding.ruleId); return rule ? { id: rule.id, name: rule.name, stage: rule.stage, enabled: binding.enabled } : null }).filter((item): item is BoundRule => item !== null)) }) }, [providerModelId])
  const persist = (next: BoundRule[]) => { setRules(next); void providerModelApi.replaceModificationRules(providerModelId, next.map((rule, priority) => ({ ruleId: rule.id, priority, enabled: rule.enabled }))) }

  const addRule = () => {
    const selected = availableRules.find(rule => rule.id === selectedRuleId)
    if (!selected || rules.some(rule => rule.id === selected.id)) return
    persist([...rules, { id: selected.id, name: selected.name, stage: selected.stage, enabled: true }])
    setSelectedRuleId('')
  }

  return (
    <section className="mt-5 border-t border-border pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium">生效规则</h3>
            <Badge variant="muted" className="font-normal">{rules.length} 条普通规则</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            为此供应商选择普通规则并调整执行顺序；全局规则无需添加，会自动生效。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
            <SelectTrigger className="h-8 w-52 text-xs" aria-label="选择普通规则">
              <SelectValue placeholder="选择普通规则" />
            </SelectTrigger>
            <SelectContent>
              {availableRules.map(rule => (
                <SelectItem key={rule.id} value={rule.id} disabled={rules.some(item => item.id === rule.id)}>
                  {rule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={!selectedRuleId}>
            <Plus /> 添加
          </Button>
        </div>
      </div>

      {rules.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-lg bg-muted/35">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-2 px-3 py-2.5 not-last:border-b not-last:border-border/60">
              <button type="button" aria-label={`调整 ${rule.name} 顺序`} className="cursor-grab text-muted-foreground/50">
                <GripVertical className="size-3.5" />
              </button>
              <span className="flex size-5 items-center justify-center rounded-sm bg-background text-[10px] text-muted-foreground">{index + 1}</span>
              <ScrollText className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{rule.name}</span>
              <Badge variant={rule.stage === 'request' ? 'secondary' : 'warning'} className="font-normal">
                {rule.stage === 'request' ? '请求' : '响应'}
              </Badge>
              <Switch
                checked={rule.enabled}
                onCheckedChange={enabled => persist(rules.map(item => item.id === rule.id ? { ...item, enabled } : item))}
                aria-label={`${rule.name}绑定状态`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => persist(rules.filter(item => item.id !== rule.id))}
                aria-label={`移除 ${rule.name}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-muted/25 px-4 py-6 text-center">
          <p className="text-xs font-medium">未添加普通规则</p>
          <p className="mt-1 text-[10px] text-muted-foreground">此供应商当前仅应用已启用的全局规则。</p>
        </div>
      )}
    </section>
  )
}
