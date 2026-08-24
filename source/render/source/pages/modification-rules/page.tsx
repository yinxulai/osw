import { useEffect, useMemo, useState } from 'react'
import { Beaker, Plus, ShieldCheck } from 'lucide-react'
import { modificationRuleApi } from '@/api/models'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { initialRules, type ModificationRule, type RuleStatusFilter } from './types'
import type { ModificationRule as ApiModificationRule, Protocol } from '@common/schemas'

const protocolLabels: Record<Protocol, string> = { 'openai-completions': 'OpenAI Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' }
const protocolValues = Object.fromEntries(Object.entries(protocolLabels).map(([value, label]) => [label, value])) as Record<string, Protocol>
function toUiRule(rule: ApiModificationRule): ModificationRule { return { id: rule.id, name: rule.name, description: rule.description, enabled: rule.enabled, global: rule.scope === 'global', builtin: rule.source === 'builtin', protocols: rule.match.clientProtocols.map(item => protocolLabels[item]), match: { clientProtocols: rule.match.clientProtocols, upstreamProtocols: rule.match.upstreamProtocols, path: rule.match.path, logicalModelId: rule.match.logicalModelId, providerModelId: rule.match.providerModelId }, actions: rule.actions.map((action, index) => ({ id: `${rule.id}-action-${index}`, stage: action.stage, target: action.type.startsWith('header-') ? 'header' : 'body', operation: action.type.endsWith('set') ? 'set' : action.type.endsWith('append') ? 'append' : action.type.endsWith('remove') || action.type.endsWith('delete') ? 'remove' : 'replace', path: 'name' in action ? action.name : action.path, value: 'value' in action && typeof action.value === 'string' ? action.value : 'search' in action ? action.search : undefined, replacement: 'replacement' in action ? action.replacement : undefined, regex: 'regex' in action ? action.regex : undefined })), boundProviders: 0, updatedAt: new Date(rule.updatedTime).toLocaleString() } }
function toApiRule(rule: ModificationRule): Omit<ApiModificationRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'> {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    scope: rule.global ? 'global' : 'model',
    schemaVersion: 1,
    source: 'user',
    match: { ...rule.match, clientProtocols: rule.protocols.map(item => protocolValues[item]), upstreamProtocols: rule.match.upstreamProtocols as Protocol[] },
    actions: rule.actions.map(action => {
      if (action.target === 'header') {
        if (action.operation === 'remove') return { type: 'header-remove', stage: action.stage, name: action.path }
        return { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
      }
      if (action.operation === 'remove') return { type: 'body-delete', stage: action.stage, path: action.path }
      if (action.operation === 'replace') return { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false }
      return { type: 'body-set', stage: action.stage, path: action.path, value: action.value ?? '' }
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
    protocols: [],
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ id: `${id}-action`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }],
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
  const [deleteTarget, setDeleteTarget] = useState<ModificationRule | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')

  const savedRule = rules.find(rule => rule.id === editingRuleId)
  const dirty = draft.updatedAt === '尚未保存'
    || (savedRule ? JSON.stringify(savedRule) !== JSON.stringify(draft) : false)
  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return rules.filter(rule => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'enabled' ? rule.enabled : !rule.enabled)
      const searchable = [rule.name, rule.description, ...rule.actions.flatMap(action => [action.target, action.operation, action.path, action.value ?? ''])]
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
    editRule(next)
  }

  const saveRule = () => { void (async () => { const result = draft.id.startsWith('rule-') && draft.updatedAt === '尚未保存' ? await modificationRuleApi.create(toApiRule(draft)) : await modificationRuleApi.update(draft.id, toApiRule(draft)); if (!result.success) { toast.error(result.errorMessage); return }; const next = toUiRule(result.data); setRules(current => current.some(rule => rule.id === next.id) ? current.map(rule => rule.id === next.id ? next : rule) : [next, ...current]); setDraft(next); setEditingRuleId(next.id); setEditorOpen(false); toast.success('请求修改已保存') })() }

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
    editRule(copy)
  }

  const deleteRule = (target: ModificationRule) => { void (async () => { const result = await modificationRuleApi.remove(target.id); if (!result.success) { toast.error(result.errorMessage); return }; setRules(current => current.filter(rule => rule.id !== target.id)); setDeleteTarget(null); setEditorOpen(false); toast.success('请求修改已删除，模型绑定已同步移除') })() }

  return (
    <PageLayout>
      <PageHeader
        title="请求修改"
        description="集中维护全局请求与响应修改规则"
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => toast.info('当前为界面预览，尚未接入执行逻辑')}>
              <Beaker /> 界面预览
            </Button>
            <Button type="button" onClick={addRule}><Plus /> 新建规则</Button>
          </div>
        )}
      />
      <PageContent>
        {loading && <div className="text-xs text-muted-foreground">正在加载 请求修改…</div>}
        <div className="flex items-center gap-2 rounded-lg bg-info/8 px-3 py-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-info" />
          全局请求修改会自动应用到所有匹配模型；普通请求修改需要在模型编辑窗口中绑定后才会生效。
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
          onDelete={setDeleteTarget}
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
        <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除“{deleteTarget?.name}”？</AlertDialogTitle>
              <AlertDialogDescription>该规则及其模型绑定将被同步移除，此操作无法撤销。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => deleteTarget && deleteRule(deleteTarget)}>删除规则</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContent>
    </PageLayout>
  )
}
