import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { routerApi } from '@/api/router'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  ROUTER_POLICY_PRESETS,
  isSameGraph,
  type RouterPolicyPreset,
  type RouterPolicyPresetId,
} from '@common/router/presets'
import type { WorkflowGraph } from '@common/router/types'
import type { VersionDraft } from './components/save-version-dialog'
import { policyPresetTextKeys } from './policy-preset-text'
import { toCanvasGraph } from './flow-projection'
import { hasSavedVersion, nextVersionNumber, toRouterGraphVersion, toRouterGraphVersions, type RouteVersion } from './route-versions'

/** 画布内容没有来源版本（内建默认策略、套用预设）时，保存弹窗的输入初值。 */
const EMPTY_VERSION_DRAFT: VersionDraft = { name: '', description: '' }

/** 内建默认策略的 id：一版都没保存过时，代理跑的就是它，画布铺的也是这张图。 */
const DEFAULT_POLICY_PRESET_ID = ROUTER_POLICY_PRESETS.find(preset => preset.isDefault)?.id

interface UseGraphVersioningOptions {
  /** 当前画布上的图，用于判定「有没有可保存的改动」与「和哪个预设一致」。 */
  graph: WorkflowGraph
  /** 读「此刻」画布图的引用，保存时用它（避免把整张图塞进回调依赖）。 */
  graphRef: MutableRefObject<WorkflowGraph>
  runtimeLogicalModels: { modelId: string; description: string; enabled: boolean }[]
  /** 整图替换（首屏载入 / 回滚 / 套预设都经它铺到画布，并清掉选中态）。 */
  loadGraph: (next: WorkflowGraph) => void
  /** 换内容时清掉上一次的运行结果。 */
  clearRunResult: () => void
}

/**
 * 图模式工作台的版本生命周期这一块：首屏载入、保存（= 发布新版本）、回滚历史版本、套内置策略。
 *
 * 与规则模式的 `rules/use-rule-versioning` 同一套结构。图数据由 `useWorkflowStudio` 的编辑核心持有，
 * 这一层通过 `loadGraph` 把载入 / 预设的内容铺到画布、通过 `clearRunResult` 清掉换内容前的运行结果。
 */
export function useGraphVersioning(options: UseGraphVersioningOptions) {
  const { graph, graphRef, runtimeLogicalModels, loadGraph, clearRunResult } = options
  const t = useTranslation()
  const toast = useToast()

  const [versions, setVersions] = useState<RouteVersion[]>([])
  const [activeGraph, setActiveGraph] = useState<WorkflowGraph | null>(null)
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [versionDraftDefaults, setVersionDraftDefaults] = useState<VersionDraft>(EMPTY_VERSION_DRAFT)

  /** 预设自带的名字与说明，作为保存弹窗的初值；没有则留空。 */
  const presetDraftDefaults = useCallback((presetId: string | undefined): VersionDraft => {
    const textKeys = presetId ? policyPresetTextKeys(presetId) : undefined
    return textKeys
      ? { name: t(textKeys.name), description: t(textKeys.description) }
      : EMPTY_VERSION_DRAFT
  }, [t])

  /** 首屏从服务端拉一次「当前生效的图」与版本列表。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [snapshot, summaries] = await Promise.all([
          unwrap(routerApi.getGraph()),
          unwrap(routerApi.getGraphVersions()),
        ])
        if (cancelled) return
        const canvasGraph = toCanvasGraph(snapshot.graph)
        loadGraph(canvasGraph)
        // 内建默认策略（版本号 0）不是已保存版本：基线留空，画布内容一律算未保存。
        setActiveGraph(hasSavedVersion(snapshot.version) ? canvasGraph : null)
        const loadedVersions = toRouterGraphVersions(summaries)
        setVersions(loadedVersions)
        const baseline = loadedVersions[0]
        setVersionDraftDefaults(
          hasSavedVersion(snapshot.version) && baseline
            ? { name: baseline.name, description: baseline.description }
            : presetDraftDefaults(DEFAULT_POLICY_PRESET_ID),
        )
      } catch (error) {
        if (cancelled) return
        toast.error(error instanceof Error ? error.message : t('router.error.loadGraph'))
      } finally {
        if (!cancelled) setGraphLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadGraph, presetDraftDefaults, toast, t])

  /** 保存 = 发布一个新版本；内容与最新版一致时服务端不会重复生成。 */
  const saveWorkflow = useCallback(async (draft: VersionDraft) => {
    const graphToSave = graphRef.current
    setSaving(true)
    try {
      const result = await unwrap(routerApi.saveGraph(graphToSave, draft.name, draft.description))
      // 存下去的这一版立刻对代理生效，它同时成为「有无改动」的新基线。
      setActiveGraph(graphToSave)
      setSaveDialogOpen(false)
      const savedVersion = toRouterGraphVersion(result)
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
  }, [graphRef, toast, t])

  /** 把历史某一版载入画布（只是编辑起点；代理仍跑当前生效版，直到再次保存）。 */
  const restoreVersion = useCallback(async (version: RouteVersion) => {
    try {
      const snapshot = await unwrap(routerApi.getGraphVersion(version.id))
      if (!snapshot) {
        toast.error(t('router.error.versionMissing', { sequence: version.sequence }))
        return
      }
      loadGraph(toCanvasGraph(snapshot.graph))
      clearRunResult()
      setVersionDraftDefaults({ name: version.name, description: version.description })
      toast.success(t('router.toast.versionLoaded', { sequence: version.sequence }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.restoreFailed'))
    }
  }, [clearRunResult, loadGraph, toast, t])

  /** 套用内置策略：整张画布换成预设内容，清掉选中态与上次运行结果。 */
  const applyPolicy = useCallback((preset: RouterPolicyPreset) => {
    loadGraph(preset.createGraph(runtimeLogicalModels))
    clearRunResult()
    setVersionDraftDefaults(presetDraftDefaults(preset.id))
    const textKeys = policyPresetTextKeys(preset.id)
    toast.success(t('router.toast.policyApplied', { name: textKeys ? t(textKeys.name) : preset.id }))
  }, [clearRunResult, loadGraph, presetDraftDefaults, runtimeLogicalModels, toast, t])

  /** 当前画布与哪个预设一致（不一致时为 null）。 */
  const activePolicyId = useMemo<RouterPolicyPresetId | null>(
    () => ROUTER_POLICY_PRESETS.find(preset => isSameGraph(preset.createGraph(runtimeLogicalModels), graph))?.id ?? null,
    [graph, runtimeLogicalModels],
  )

  /** 画布相对「当前生效的那一版」有改动才允许保存。 */
  const canSave = graphLoaded && !saving && (activeGraph === null || !isSameGraph(activeGraph, graph))

  const nextVersion = nextVersionNumber(versions)

  return {
    versions,
    versionDraftDefaults,
    saving,
    saveDialogOpen,
    setSaveDialogOpen,
    activePolicyId,
    canSave,
    nextVersion,
    applyPolicy,
    restoreVersion,
    saveWorkflow,
  }
}
