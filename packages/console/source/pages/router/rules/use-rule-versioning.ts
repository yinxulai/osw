import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import { routerRulesApi } from '@/api/router-rules'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { isSameRouteRuleSet, type RouteRuleSet } from '@common/router/route-rules'
import { ROUTER_RULE_PRESETS, type RouterRulePreset } from '@common/router/rule-presets'
import type { RuntimeLogicalModel } from '@common/router/types'
import type { VersionDraft } from '../components/save-version-dialog'
import { hasSavedVersion, toRouteRuleSetVersion, toRouteRuleSetVersions, type RouteVersion } from '../route-versions'
import { rulePresetTextKeys } from './rules-preset-text'

const EMPTY_VERSION_DRAFT: VersionDraft = { name: '', description: '' }

/** 内建默认规则表（菜单里那一项「逻辑模型命中」）的 id。 */
const DEFAULT_RULE_PRESET_ID = ROUTER_RULE_PRESETS.find(preset => preset.isDefault)?.id

interface UseRuleVersioningOptions {
  /** 当前的规则表草稿，用于判定「有没有可保存的改动」。 */
  ruleSet: RouteRuleSet
  /** 读「此刻」规则表的引用，保存时用它（避免把整张表塞进回调依赖）。 */
  ruleSetRef: MutableRefObject<RouteRuleSet>
  runtimeLogicalModels: RuntimeLogicalModel[]
  /** 整表替换（首屏载入 / 回滚 / 套预设都经它写回草稿并归零行内状态）。 */
  loadRuleSet: (next: RouteRuleSet) => void
  /** 换内容时清掉上一次的试跑结果。 */
  clearRunResult: () => void
}

/**
 * 版本生命周期这一块：首屏载入、保存（= 发布新版本）、回滚历史版本、套内置预设。
 *
 * 规则表草稿由 `useRuleSetEditing` 持有；这一层通过 `loadRuleSet` 把载入 / 预设的内容写回草稿，
 * 通过 `clearRunResult` 清掉换内容前的试跑结果。保存 / 回滚 / 预设与图模式逐一对应。
 */
export function useRuleVersioning(options: UseRuleVersioningOptions) {
  const { ruleSet, ruleSetRef, runtimeLogicalModels, loadRuleSet, clearRunResult } = options
  const t = useTranslation()
  const toast = useToast()

  const [activeRuleSet, setActiveRuleSet] = useState<RouteRuleSet | null>(null)
  const [versions, setVersions] = useState<RouteVersion[]>([])
  const [versionDraftDefaults, setVersionDraftDefaults] = useState<VersionDraft>(EMPTY_VERSION_DRAFT)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  /** 预设自带的名字与说明，作为保存弹窗的初值；没有则留空。 */
  const presetDraftDefaults = useCallback((presetId: string | undefined): VersionDraft => {
    const textKeys = presetId ? rulePresetTextKeys(presetId) : undefined
    return textKeys
      ? { name: t(textKeys.name), description: t(textKeys.description) }
      : EMPTY_VERSION_DRAFT
  }, [t])

  /** 首屏从服务端拉一次「当前生效的规则表」与版本列表。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [snapshot, summaries] = await Promise.all([
          unwrap(routerRulesApi.getRules()),
          unwrap(routerRulesApi.getRuleVersions()),
        ])
        if (cancelled) return

        loadRuleSet(snapshot.ruleSet)
        // 内建默认表（版本号 0）不是已保存版本：基线留空，列表内容一律算未保存。
        setActiveRuleSet(hasSavedVersion(snapshot.version) ? snapshot.ruleSet : null)
        const loadedVersions = toRouteRuleSetVersions(summaries)
        setVersions(loadedVersions)
        const baseline = loadedVersions[0]
        setVersionDraftDefaults(
          hasSavedVersion(snapshot.version) && baseline
            ? { name: baseline.name, description: baseline.description }
            : presetDraftDefaults(DEFAULT_RULE_PRESET_ID),
        )
      } catch (error) {
        if (cancelled) return
        toast.error(error instanceof Error ? error.message : t('router.rules.error.load'))
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [loadRuleSet, presetDraftDefaults, toast, t])

  /** 保存 = 发布一个新版本；内容与最新版一致时服务端不会重复生成。 */
  const saveRules = useCallback(async (draft: VersionDraft) => {
    const ruleSetToSave = ruleSetRef.current
    setSaving(true)
    try {
      const result = await unwrap(routerRulesApi.saveRules(ruleSetToSave, draft.name, draft.description))
      // 存下去的这一版立刻对代理生效，它同时成为「有无改动」的新基线。
      setActiveRuleSet(ruleSetToSave)
      setSaveDialogOpen(false)
      const savedVersion = toRouteRuleSetVersion(result)
      setVersionDraftDefaults({ name: savedVersion.name, description: savedVersion.description })
      if (!result.created) {
        toast.info(t('router.toast.identicalToLatest', { version: result.version }))
        return
      }
      setVersions(current => [savedVersion, ...current])
      toast.success(t('router.toast.versionSaved', { version: result.version }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [ruleSetRef, toast, t])

  /** 把历史某一版载入列表（只是编辑起点；代理仍跑当前生效版，直到再次保存）。 */
  const restoreVersion = useCallback(async (version: RouteVersion) => {
    try {
      const snapshot = await unwrap(routerRulesApi.getRuleVersion(version.id))
      if (!snapshot) {
        toast.error(t('router.error.versionMissing', { sequence: version.sequence }))
        return
      }
      loadRuleSet(snapshot.ruleSet)
      clearRunResult()
      setVersionDraftDefaults({ name: version.name, description: version.description })
      toast.success(t('router.toast.versionLoaded', { sequence: version.sequence }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.restoreFailed'))
    }
  }, [clearRunResult, loadRuleSet, toast, t])

  /** 套用内置预设：整张规则表换成预设内容，清掉行内状态与上次试跑。 */
  const applyPreset = useCallback((preset: RouterRulePreset) => {
    loadRuleSet(preset.createRuleSet(runtimeLogicalModels))
    clearRunResult()
    setVersionDraftDefaults(presetDraftDefaults(preset.id))
    const textKeys = rulePresetTextKeys(preset.id)
    toast.success(t('router.toast.presetApplied', { name: textKeys ? t(textKeys.name) : preset.id }))
  }, [clearRunResult, loadRuleSet, presetDraftDefaults, runtimeLogicalModels, toast, t])

  /** 列表相对「当前生效的那一版」有改动才允许保存。 */
  const canSave = loaded && !saving && (activeRuleSet === null || !isSameRouteRuleSet(activeRuleSet, ruleSet))

  /** 这一次保存会拿到的版本号（版本列表为空时就是首版）。 */
  const nextVersion = (versions[0]?.sequence ?? 0) + 1

  return {
    versions,
    versionDraftDefaults,
    loaded,
    saving,
    saveDialogOpen,
    setSaveDialogOpen,
    canSave,
    nextVersion,
    saveRules,
    restoreVersion,
    applyPreset,
  }
}
