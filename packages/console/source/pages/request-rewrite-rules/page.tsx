import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { requestRewriteRuleApi } from '@/api/models'
import { localizeErrorCode } from '@/api/errors'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RulePresetMenu } from './components/rule-preset-menu'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { createBlankRule, createRuleFromPreset, type RulePreset } from './rule-presets'
import { formatJsonActionValue, parseJsonActionValue, type RequestRewriteRule, type RuleStatusFilter } from './types'
import type { RequestRewriteRule as ApiRequestRewriteRule, Protocol } from '@common/schemas'

function toUiRule(rule: ApiRequestRewriteRule): RequestRewriteRule { return { id: rule.id, name: rule.name, description: rule.description, enabled: rule.enabled, global: rule.scope === 'global', source: rule.source, protocols: rule.match.clientProtocols, match: { clientProtocols: rule.match.clientProtocols, upstreamProtocols: rule.match.upstreamProtocols }, actions: rule.actions.map((action, index) => ({ id: `${rule.id}-action-${index}`, stage: action.stage, target: action.type.startsWith('header-') ? 'header' : 'body', operation: action.type.endsWith('set') ? 'set' : action.type.endsWith('append') ? 'append' : action.type.endsWith('remove') || action.type.endsWith('delete') ? 'remove' : 'replace', path: 'name' in action ? action.name : action.path, value: 'value' in action ? (action.type === 'body-set' ? formatJsonActionValue(action.value) : String(action.value)) : 'search' in action ? action.search : undefined, replacement: 'replacement' in action ? action.replacement : undefined, regex: 'regex' in action ? action.regex : undefined })), testCases: rule.testCases.map(testCase => ({ ...testCase })), boundProviders: 0, updatedTime: rule.updatedTime } }
function toApiRule(rule: RequestRewriteRule): Omit<ApiRequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'> {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    scope: rule.global ? 'global' : 'model',
    schemaVersion: 1,
    // 原样回传：它是用户数据的一部分（编辑一条从模板建的规则不能把它改成「自己写的」），
    // 也是 `rewrite_rule_created.kind` 唯一的来源。
    source: rule.source,
    match: { clientProtocols: rule.protocols, upstreamProtocols: rule.match.upstreamProtocols as Protocol[] },
    actions: rule.actions.map(action => {
      if (action.target === 'header') {
        if (action.operation === 'remove') return { type: 'header-remove', stage: action.stage, name: action.path }
        return { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
      }
      if (action.operation === 'remove') return { type: 'body-delete', stage: action.stage, path: action.path }
      if (action.operation === 'replace') return { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false }
      return { type: 'body-set', stage: action.stage, path: action.path, value: parseJsonActionValue(action.value) }
    }),
    testCases: rule.testCases,
  }
}

export function RequestRewriteRulesPage() {
  const t = useTranslation()
  const toast = useToast()
  const [rules, setRules] = useState<RequestRewriteRule[]>([])
  const [editingRuleId, setEditingRuleId] = useState('')
  const [draft, setDraft] = useState<RequestRewriteRule>(() => createBlankRule(t))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  /**
   * 列表加载失败要留在界面上，并留一个「重试」。
   *
   * 之前只在 `success` 分支里写状态：服务端失败时页面一声不吭，用户看到的是空表加一个
   * 「新建」按钮——像是规则从来没配过，而不是没读到。
   */
  const loadRules = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await requestRewriteRuleApi.list()
    if (!result.success) {
      setLoadError(localizeErrorCode(result.errorCode, result.errorMessage, result.errorParams))
      setLoading(false)
      return
    }
    const next = result.data.map(toUiRule)
    setRules(next)
    if (next[0]) { setEditingRuleId(next[0].id); setDraft(next[0]) }
    setLoading(false)
  }, [])
  useEffect(() => { void loadRules() }, [loadRules])
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RequestRewriteRule | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')

  const savedRule = rules.find(rule => rule.id === editingRuleId)
  const dirty = draft.updatedTime === null
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

  const editRule = (rule: RequestRewriteRule) => {
    setEditingRuleId(rule.id)
    setDraft(rule)
    setEditorOpen(true)
  }

  const addRule = () => {
    editRule(createBlankRule(t))
  }

  /** 模板同样是**未保存**的草稿：填入内容、打开编辑器，由用户自己确认后保存。 */
  const addRuleFromPreset = (preset: RulePreset) => {
    editRule(createRuleFromPreset(preset, t))
  }

  const saveRule = () => { void (async () => { const result = draft.updatedTime === null ? await requestRewriteRuleApi.create(toApiRule(draft)) : await requestRewriteRuleApi.update(draft.id, toApiRule(draft)); if (!result.success) { toast.error(result.errorMessage); return }; const next = toUiRule(result.data); setRules(current => current.some(rule => rule.id === next.id) ? current.map(rule => rule.id === next.id ? next : rule) : [next, ...current]); setDraft(next); setEditingRuleId(next.id); setEditorOpen(false); toast.success(t('rules.saved')) })() }

  const duplicateRule = (source: RequestRewriteRule = draft) => {
    const copy: RequestRewriteRule = {
      ...source,
      id: `rule-${Date.now()}`,
      name: t('rules.duplicateSuffix', { name: source.name }),
      global: false,
      boundProviders: 0,
      updatedTime: null,
      actions: source.actions.map((action, index) => ({ ...action, id: `action-${Date.now()}-${index}` })),
      testCases: source.testCases.map((testCase, index) => ({ ...testCase, id: `test-${Date.now()}-${index}` })),
    }
    editRule(copy)
  }

  const deleteRule = (target: RequestRewriteRule) => { void (async () => { const result = await requestRewriteRuleApi.remove(target.id); if (!result.success) { toast.error(result.errorMessage); return }; setRules(current => current.filter(rule => rule.id !== target.id)); setDeleteTarget(null); setEditorOpen(false); toast.success(t('rules.deleted')) })() }

  /**
   * 开关先改本地、再发请求，服务端失败就翻回来并报错。
   *
   * 之前这里既不看返回值也不回滚：请求被拒绝时界面上开关是新值、库里还是旧值，
   * 用户要等到下次打开页面才发现那次点击根本没生效。
   *
   * 成功时只回填服务端真正确认的字段（`enabled` 与 `updatedTime`），不整行替换：
   * 列表行里的绑定数不在这个响应里，整行替换会把它抹成 0。
   */
  const toggleRule = (rule: RequestRewriteRule, enabled: boolean) => {
    void (async () => {
      const previous = rule.enabled
      setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled } : item))
      const result = await requestRewriteRuleApi.update(rule.id, toApiRule({ ...rule, enabled }))
      if (result.success) {
        setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled: result.data.enabled, updatedTime: result.data.updatedTime } : item))
        return
      }
      setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled: previous } : item))
      toast.error(localizeErrorCode(result.errorCode, result.errorMessage, result.errorParams))
    })()
  }

  return (
    <PageLayout>
      <PageHeader
        title={t('rules.title')}
        description={t('rules.description')}
        actions={(
          <div className="flex items-center gap-2">
            <RulePresetMenu onCreateBlank={addRule} onCreateFromPreset={addRuleFromPreset} />
          </div>
        )}
      />
      <PageContent>
        {loading && <div className="system-xs-regular text-text-tertiary">{t('rules.loading')}</div>}
        {loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadRules()}>{t('common.action.retry')}</Button>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2 system-xs-regular text-text-tertiary">
          <ShieldCheck className="size-3.5 shrink-0 text-info" />
          {t('rules.notice')}
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
          onToggle={toggleRule}
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
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={t('rules.delete.title', { name: deleteTarget?.name ?? '' })}
          description={t('rules.delete.description')}
          confirmLabel={t('rules.delete.confirm')}
          variant="destructive"
          onConfirm={() => deleteTarget && deleteRule(deleteTarget)}
          onOpenChange={open => !open && setDeleteTarget(null)}
        />
      </PageContent>
    </PageLayout>
  )
}
