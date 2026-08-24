import { useEffect, useState } from 'react'
import { GripVertical, Plus, ScrollText, Trash2 } from 'lucide-react'
import { modificationRuleApi, providerModelApi } from '@/api/models'
import type { ModificationRule } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface BoundRule { id: string; name: string; stages: Array<'request' | 'response'>; enabled: boolean; global: boolean }

interface ProviderRuleBindingsProps {
  providerModelId: string
  embedded?: boolean
}

export function ProviderRuleBindings(props: ProviderRuleBindingsProps) {
  const { providerModelId, embedded = false } = props
  const [availableRules, setAvailableRules] = useState<ModificationRule[]>([])
  const [rules, setRules] = useState<BoundRule[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState('')
  useEffect(() => { void Promise.all([modificationRuleApi.list(), providerModelApi.modificationRules(providerModelId)]).then(([allResponse, bindingsResponse]) => { if (!allResponse.success || !bindingsResponse.success) return; const all = allResponse.data; const bindings = bindingsResponse.data; const globalRules = all.filter(rule => rule.scope === 'global'); setAvailableRules(all.filter(rule => rule.scope !== 'global')); setRules([...globalRules.map(rule => ({ id: rule.id, name: rule.name, stages: [...new Set(rule.actions.map(action => action.stage))], enabled: rule.enabled, global: true })), ...bindings.map(binding => { const rule = all.find(item => item.id === binding.ruleId); return rule && rule.scope !== 'global' ? { id: rule.id, name: rule.name, stages: [...new Set(rule.actions.map(action => action.stage))], enabled: binding.enabled && rule.enabled, global: false } : null }).filter((item): item is BoundRule => item !== null)]) }) }, [providerModelId])
  const persist = (next: BoundRule[]) => { setRules(next); void providerModelApi.replaceModificationRules(providerModelId, next.filter(rule => !rule.global).map((rule, priority) => ({ ruleId: rule.id, priority, enabled: rule.enabled }))) }

  const addRule = () => {
    const selected = availableRules.find(rule => rule.id === selectedRuleId)
    if (!selected || rules.some(rule => rule.id === selected.id)) return
    persist([...rules, { id: selected.id, name: selected.name, stages: [...new Set(selected.actions.map(action => action.stage))], enabled: true, global: false }])
    setSelectedRuleId('')
  }

  return (
    <section className={embedded ? 'space-y-3 pt-1' : 'mt-5 border-t border-border pt-4'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium">请求修改</h3>
            <Badge variant="muted" className="font-normal">{rules.length} 条（含全局）</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            全局请求修改会自动生效且不可编辑；普通请求修改可在此绑定并调整顺序。
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
              {rule.stages.map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? '请求' : '响应'}</Badge>)}
              {rule.global ? <Badge variant="muted" className="font-normal">全局{!rule.enabled && ' · 停用'}</Badge> : <>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={enabled => persist(rules.map(item => item.id === rule.id ? { ...item, enabled } : item))}
                  aria-label={`${rule.name}绑定状态`}
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => persist(rules.filter(item => item.id !== rule.id))} aria-label={`移除 ${rule.name}`} className="text-muted-foreground hover:text-destructive">
                  <Trash2 />
                </Button>
              </>}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-muted/25 px-4 py-6 text-center">
          <p className="text-xs font-medium">未添加普通规则</p>
          <p className="mt-1 text-[10px] text-muted-foreground">当前模型会自动应用已启用的全局请求修改。</p>
        </div>
      )}
    </section>
  )
}
