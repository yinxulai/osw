import { useEffect, useMemo, useState } from 'react'
import { Beaker, Plus, ShieldCheck } from 'lucide-react'
import { modificationRuleApi } from '@/api/models'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { initialRules, type ModificationRule, type RuleStatusFilter } from './types'
import type { ModificationRule as ApiModificationRule, Protocol } from '@common/schemas'

const protocolLabels: Record<Protocol, string> = { 'openai-completions': 'OpenAI Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' }
const protocolValues = Object.fromEntries(Object.entries(protocolLabels).map(([value, label]) => [label, value])) as Record<string, Protocol>
function toUiRule(rule: ApiModificationRule): ModificationRule { return { id: rule.id, name: rule.name, description: rule.description, enabled: rule.enabled, global: false, stage: rule.stage, protocols: rule.match.clientProtocols.map(item => protocolLabels[item]), actions: rule.actions.map((action, index) => ({ id: `${rule.id}-action-${index}`, type: action.type, target: 'name' in action ? action.name : action.path, value: 'value' in action && typeof action.value === 'string' ? action.value : 'search' in action ? action.search : undefined, replacement: 'replacement' in action ? action.replacement : undefined })), boundProviders: 0, updatedAt: new Date(rule.updatedTime).toLocaleString() } }
function toApiRule(rule: ModificationRule): Omit<ApiModificationRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'> {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    stage: rule.stage,
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: rule.protocols.map(item => protocolValues[item]), upstreamProtocols: [] },
    actions: rule.actions.map(action => {
      if (action.type === 'header-remove' || action.type === 'json-delete') return action.type === 'header-remove' ? { type: action.type, name: action.target } : { type: action.type, path: action.target }
      if (action.type === 'header-set' || action.type === 'header-append') return { type: action.type, name: action.target, value: action.value ?? '' }
      if (action.type === 'json-set') return { type: action.type, path: action.target, value: action.value ?? '' }
      return { type: action.type, path: action.target, search: action.value ?? '', replacement: action.replacement ?? '' }
    }),
    }
}

function createRule(): ModificationRule {
  const id = `rule-${Date.now()}`
  return {
    id,
    name: '未命名规则',
    description: '',
    enabled: true,
    global: false,
    stage: 'request',
    protocols: [],
    actions: [{ id: `${id}-action`, type: 'header-set', target: '', value: '' }],
    boundProviders: 0,
    updatedAt: '尚未保存',
  }
}

export function ModificationRulesPage() {
  const toast = useToast()
  const [rules, setRules] = useState<ModificationRule[]>([])
  const [editingRuleId, setEditingRuleId] = useState('')
  const [draft, setDraft] = useState<ModificationRule>(initialRules[0])
  const [loading, setLoading] = useState(true)
  useEffect(() => { void modificationRuleApi.list().then(result => { if (result.success) { const next = result.data.map(toUiRule); setRules(next); if (next[0]) { setEditingRuleId(next[0].id); setDraft(next[0]) } } setLoading(false) }) }, [])
  const [editorOpen, setEditorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')

  const savedRule = rules.find(rule => rule.id === editingRuleId) ?? rules[0]
  const dirty = draft.updatedAt === '尚未保存'
    || (savedRule ? JSON.stringify(savedRule) !== JSON.stringify(draft) : false)
  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return rules.filter(rule => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'enabled' ? rule.enabled : !rule.enabled)
      const searchable = [rule.name, rule.description, ...rule.actions.flatMap(action => [action.target, action.value ?? ''])]
        .join(' ')
        .toLocaleLowerCase()
      return matchesStatus && (!keyword || searchable.includes(keyword))
    })
  }, [rules, search, statusFilter])

  const editRule = (rule: ModificationRule) => {
    setEditingRuleId(rule.id)
    setDraft(rule)
    setEditorOpen(true)
  }

  const addRule = () => {
    const next = createRule()
    setRules(current => [next, ...current])
    editRule(next)
  }

  const saveRule = () => { void (async () => { const result = draft.id.startsWith('rule-') && draft.updatedAt === '尚未保存' ? await modificationRuleApi.create(toApiRule(draft)) : await modificationRuleApi.update(draft.id, toApiRule(draft)); if (!result.success) { toast.error(result.errorMessage); return }; const next = toUiRule(result.data); setRules(current => current.some(rule => rule.id === next.id) ? current.map(rule => rule.id === next.id ? next : rule) : [next, ...current]); setDraft(next); setEditingRuleId(next.id); setEditorOpen(false); toast.success('修改规则已保存') })() }

  const duplicateRule = (source: ModificationRule = draft) => {
    const copy: ModificationRule = {
      ...source,
      id: `rule-${Date.now()}`,
      name: `${source.name} 副本`,
      global: false,
      boundProviders: 0,
      updatedAt: '尚未保存',
      actions: source.actions.map((action, index) => ({ ...action, id: `action-${Date.now()}-${index}` })),
    }
    setRules(current => [copy, ...current])
    editRule(copy)
  }

  const deleteRule = (target: ModificationRule = draft) => { void (async () => { const result = await modificationRuleApi.remove(target.id); if (!result.success) { toast.error(result.errorMessage); return }; setRules(current => current.filter(rule => rule.id !== target.id)); setEditorOpen(false); toast.success('修改规则已删除，已有绑定将保留但不再执行') })() }

  return (
    <PageLayout>
      <PageHeader
        title="修改规则"
        description="集中维护全局规则与供应商可选规则"
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => toast.info('当前为界面预览，尚未接入执行逻辑')}>
              <Beaker /> 界面预览
            </Button>
            <Button type="button" size="sm" onClick={addRule}><Plus /> 新建规则</Button>
          </div>
        )}
      />
      <PageContent>
        {loading && <div className="text-xs text-muted-foreground">正在加载修改规则…</div>}
        <div className="flex items-center gap-2 rounded-lg bg-info/8 px-3 py-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-info" />
          全局规则自动应用到所有匹配请求；普通规则需要在供应商管理中添加后才会生效。
        </div>
        <RuleStats rules={rules} />
        <RulesTable
          rules={filteredRules}
          search={search}
          statusFilter={statusFilter}
          onSearchChange={setSearch}
          onStatusFilterChange={setStatusFilter}
          onEdit={editRule}
          onDuplicate={duplicateRule}
          onDelete={deleteRule}
          onToggle={(rule, enabled) => { setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled } : item)); void modificationRuleApi.update(rule.id, toApiRule({ ...rule, enabled })) }}
        />
        <RuleEditorDialog
          open={editorOpen}
          rule={draft}
          dirty={dirty}
          onOpenChange={setEditorOpen}
          onChange={setDraft}
          onSave={saveRule}
          onReset={() => savedRule && setDraft(savedRule)}
        />
      </PageContent>
    </PageLayout>
  )
}
