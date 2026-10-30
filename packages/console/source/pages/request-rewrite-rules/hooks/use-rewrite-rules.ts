import { useCallback, useEffect, useMemo, useState } from 'react'
import { requestRewriteRuleApi } from '@/api/models'
import { localizeErrorCode } from '@/api/errors'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { createBlankRule, createRuleFromPreset, type RulePreset } from '../rule-presets'
import type { RequestRewriteRule, RuleStatusFilter } from '../types'
import { toApiRule, toUiRule } from '../lib/rule-mapping'
import { duplicateRule as cloneRule, filterRules, isRuleDirty } from '../lib/rule-list'

/**
 * 请求改写规则页的**绑定层**。
 *
 * 纯逻辑（服务端 ↔ 界面映射、脏判定、过滤、复制改 id）都在 `../lib`，可脱离 React 单测；
 * 这个 hook 只负责把它们接到 react state 与后端 CRUD 上，页面退回到纯组合渲染。
 */
export function useRewriteRules() {
  const t = useTranslation()
  const toast = useToast()
  const [rules, setRules] = useState<RequestRewriteRule[]>([])
  const [editingRuleId, setEditingRuleId] = useState('')
  const [draft, setDraft] = useState<RequestRewriteRule>(() => createBlankRule(t))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RequestRewriteRule | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')

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
    if (next[0]) {
      setEditingRuleId(next[0].id)
      setDraft(next[0])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadRules() }, [loadRules])

  const savedRule = rules.find(rule => rule.id === editingRuleId)
  const dirty = isRuleDirty(savedRule, draft)
  const filteredRules = useMemo(() => filterRules(rules, search, statusFilter), [rules, search, statusFilter])

  const editRule = (rule: RequestRewriteRule) => {
    setEditingRuleId(rule.id)
    setDraft(rule)
    setEditorOpen(true)
  }

  const addRule = () => editRule(createBlankRule(t))

  /** 模板同样是**未保存**的草稿：填入内容、打开编辑器，由用户自己确认后保存。 */
  const addRuleFromPreset = (preset: RulePreset) => editRule(createRuleFromPreset(preset, t))

  const saveRule = () => {
    void (async () => {
      const result = draft.updatedTime === null
        ? await requestRewriteRuleApi.create(toApiRule(draft))
        : await requestRewriteRuleApi.update(draft.id, toApiRule(draft))
      if (!result.success) {
        toast.error(result.errorMessage)
        return
      }
      const next = toUiRule(result.data)
      setRules(current => current.some(rule => rule.id === next.id) ? current.map(rule => rule.id === next.id ? next : rule) : [next, ...current])
      setDraft(next)
      setEditingRuleId(next.id)
      setEditorOpen(false)
      toast.success(t('rules.saved'))
    })()
  }

  const duplicateRule = (source: RequestRewriteRule = draft) => {
    editRule(cloneRule(source, { name: t('rules.duplicateSuffix', { name: source.name }), now: Date.now() }))
  }

  const deleteRule = (target: RequestRewriteRule) => {
    void (async () => {
      const result = await requestRewriteRuleApi.remove(target.id)
      if (!result.success) {
        toast.error(result.errorMessage)
        return
      }
      setRules(current => current.filter(rule => rule.id !== target.id))
      setDeleteTarget(null)
      setEditorOpen(false)
      toast.success(t('rules.deleted'))
    })()
  }

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

  return {
    rules,
    filteredRules,
    loading,
    loadError,
    loadRules,
    draft,
    setDraft,
    dirty,
    savedRule,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    editorOpen,
    setEditorOpen,
    deleteTarget,
    setDeleteTarget,
    editRule,
    addRule,
    addRuleFromPreset,
    saveRule,
    duplicateRule,
    deleteRule,
    toggleRule,
  }
}
