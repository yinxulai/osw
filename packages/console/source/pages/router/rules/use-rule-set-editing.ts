import { useCallback, useMemo, useState, useRef } from 'react'
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  createDefaultRouteRuleSet,
  createRouteRule,
  isSameRouteRuleSet,
  MAX_ROUTE_RULES,
  type RouteRule,
  type RouteRuleSet,
} from '@common/router/route-rules'
import { ROUTER_RULE_PRESETS } from '@common/router/rule-presets'
import type { RuntimeLogicalModel } from '@common/router/types'
import { appendRule, duplicateRuleInSet, patchRuleInSet, removeRuleFromSet, reorderRules, toggleFallbackModelInSet } from './rule-ops'

/**
 * 规则表草稿这一块：规则表本身、逐条编辑、拖拽排序，以及行内的「展开 / 待填名 / 兜底区 / 待删」状态。
 *
 * 纯变换都在 `./rule-ops`（可脱离 React 单测），这里只把它们接到 `setRuleSet` 与交互状态上。
 * 整表替换（套预设 / 载入版本 / 首屏载入）统一走 `loadRuleSet`——它顺手把行内状态归零，
 * 因为那些状态对应的是换掉之前的那份内容。
 */
export function useRuleSetEditing(runtimeLogicalModels: RuntimeLogicalModel[]) {
  const [ruleSet, setRuleSet] = useState<RouteRuleSet>(() => createDefaultRouteRuleSet(runtimeLogicalModels))

  // 试跑从回调里读「此刻」的规则表：用 ref 持同一份引用，省得把整张表塞进回调依赖。
  const ruleSetRef = useRef(ruleSet)
  ruleSetRef.current = ruleSet

  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null)
  const [freshRuleId, setFreshRuleId] = useState<string | null>(null)
  const [fallbackExpanded, setFallbackExpanded] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RouteRule | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** 整表替换：换内容的同时把行内状态归零（展开 / 待填名 / 兜底区）。 */
  const loadRuleSet = useCallback((next: RouteRuleSet) => {
    setRuleSet(next)
    setExpandedRuleId(null)
    setFreshRuleId(null)
    setFallbackExpanded(false)
  }, [])

  const patchRule = useCallback((ruleId: string, patch: Partial<RouteRule>) => {
    setRuleSet(current => patchRuleInSet(current, ruleId, patch))
  }, [])

  /** 新建一条规则，追加在**末尾**（放最后不影响现有分流，用户拖到哪格才算生效）。 */
  const createRule = useCallback(() => {
    const rule = createRouteRule()
    setRuleSet(current => appendRule(current, rule))
    setExpandedRuleId(rule.id)
    setFreshRuleId(rule.id)
  }, [])

  const toggleExpandRule = useCallback((ruleId: string | null) => {
    setExpandedRuleId(ruleId)
    if (ruleId === null) setFreshRuleId(null)
  }, [])

  const duplicateRule = useCallback((ruleId: string) => {
    setRuleSet(current => duplicateRuleInSet(current, ruleId))
  }, [])

  const toggleRuleEnabled = useCallback((ruleId: string, enabled: boolean) => {
    patchRule(ruleId, { enabled })
  }, [patchRule])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRuleSet(current => reorderRules(current, active.id, over.id))
  }, [])

  const toggleFallbackModel = useCallback((modelId: string, checked: boolean) => {
    setRuleSet(current => toggleFallbackModelInSet(current, modelId, checked))
  }, [])

  const toggleFallback = useCallback(() => setFallbackExpanded(value => !value), [])

  const requestDelete = useCallback((ruleId: string) => {
    setDeleteTarget(ruleSetRef.current.rules.find(rule => rule.id === ruleId) ?? null)
  }, [])

  const dismissDelete = useCallback(() => setDeleteTarget(null), [])

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return
    const ruleId = deleteTarget.id
    setRuleSet(current => removeRuleFromSet(current, ruleId))
    setExpandedRuleId(current => (current === ruleId ? null : current))
    setDeleteTarget(null)
  }, [deleteTarget])

  const atLimit = ruleSet.rules.length >= MAX_ROUTE_RULES

  /** 当前规则表与哪个预设一致（不一致时为 null）。 */
  const activePresetId = useMemo(
    () => ROUTER_RULE_PRESETS.find(preset => isSameRouteRuleSet(preset.createRuleSet(runtimeLogicalModels), ruleSet))?.id ?? null,
    [ruleSet, runtimeLogicalModels],
  )

  return {
    ruleSet,
    ruleSetRef,
    sensors,
    atLimit,
    activePresetId,
    expandedRuleId,
    freshRuleId,
    fallbackExpanded,
    deleteTarget,
    loadRuleSet,
    patchRule,
    createRule,
    toggleExpandRule,
    duplicateRule,
    toggleRuleEnabled,
    handleDragEnd,
    toggleFallbackModel,
    toggleFallback,
    requestDelete,
    dismissDelete,
    confirmDelete,
  }
}
