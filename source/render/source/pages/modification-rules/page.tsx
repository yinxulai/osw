import { useMemo, useState } from 'react'
import { Beaker, Plus, ShieldCheck } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { initialRules, type ModificationRule, type RuleStatusFilter } from './types'

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
  const [rules, setRules] = useState(initialRules)
  const [editingRuleId, setEditingRuleId] = useState(initialRules[0].id)
  const [draft, setDraft] = useState<ModificationRule>(initialRules[0])
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

  const saveRule = () => {
    const next = { ...draft, updatedAt: '刚刚' }
    setRules(current => current.map(rule => rule.id === next.id ? next : rule))
    setDraft(next)
    setEditorOpen(false)
    toast.success('界面草稿已更新，当前仅保存在页面内存中')
  }

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

  const deleteRule = (target: ModificationRule = draft) => {
    setRules(current => current.filter(rule => rule.id !== target.id))
    setEditorOpen(false)
    toast.info(target.boundProviders > 0
      ? `已从界面草稿中删除；真实实现时将先确认 ${target.boundProviders} 个供应商配置`
      : '已从界面草稿中删除')
  }

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
          onToggle={(rule, enabled) => setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled } : item))}
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
