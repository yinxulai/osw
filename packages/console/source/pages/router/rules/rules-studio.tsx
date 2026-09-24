import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CirclePlay, Plus, Save } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { routerRulesApi } from '@/api/router-rules'
import { unwrap } from '@/api/unwrap'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import type { RouteRuleRunResult } from '@common/router/route-rule-engine'
import {
  createDefaultRouteRuleSet,
  createRouteRule,
  isSameRouteRuleSet,
  MAX_ROUTE_RULES,
  type RouteRule,
  type RouteRuleSet,
} from '@common/router/route-rules'
import { ROUTER_RULE_PRESETS, type RouterRulePreset } from '@common/router/rule-presets'
import { createId, samplePayload } from '@common/router/presets'
import { RouteModeSwitch } from '../components/route-mode-switch'
import { SaveVersionDialog, type VersionDraft } from '../components/save-version-dialog'
import { VersionMenu } from '../components/version-menu'
import { WorkflowButton } from '../components/workflow-button'
import { hasSavedVersion, toRouteRuleSetVersion, toRouteRuleSetVersions, type RouteVersion } from '../route-versions'
import { RulesList } from './rules-list'
import { RulesPresetMenu } from './rules-preset-menu'
import { rulePresetTextKeys } from './rules-preset-text'
import { RulesRunDrawer } from './rules-run-drawer'

const EMPTY_VERSION_DRAFT: VersionDraft = { name: '', description: '' }

/**
 * 内建默认规则表（菜单里那一项「逻辑模型命中」）的 id。
 *
 * 一版都没保存过时，保存弹窗的两个框空着不是「没得写」，而是用户得自己想一个名字；
 * 直接把它填成这份表自己的名字 —— 列表上铺的确实就是这条预设。
 */
const DEFAULT_RULE_PRESET_ID = ROUTER_RULE_PRESETS.find(preset => preset.isDefault)?.id

/**
 * 规则模式的工作台。
 *
 * 它和图模式的工作台是**两个页面**：共用 `PageLayout` / `PageHeader` 与保存弹窗、版本列表这些外壳，
 * 但正文、编辑方式、试跑结果全部各写各的 —— 画布的「节点 + 面板 + Trace」与规则表的
 * 「顺序列表 + 行内编辑 + 逐条判定」不是同一个界面换个数据源，硬把它们抽象到一个组件里，
 * 两边都会剩下一半用不上的东西。
 *
 * 两个模式的**生命周期是同一套**：列表上改的是草稿，按下「保存」才生成一个可回滚的新版本，
 * 代理读的永远是最近保存的那一版。所以页头动作也逐一对应 —— 试运行、保存、历史版本，
 * 连保存弹窗都是同一个（只有说明文案与版本规模量词不一样）。
 *
 * 这一层只持有规则表本身与各种「打开 / 关闭」状态；一条规则怎么读、怎么改、怎么排序，
 * 都在 `RulesList` 与它下面的组件里 —— 这样列表的排版可以整体重做而不牵动数据流。
 */
export function RouteRulesStudio() {
  const t = useTranslation()
  const toast = useToast()
  const logicalModels = useLogicalModels()

  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })),
    [logicalModels],
  )

  const [ruleSet, setRuleSet] = useState<RouteRuleSet>(() => createDefaultRouteRuleSet(runtimeLogicalModels))

  /**
   * 试跑是从回调里发起的，而它要读「此刻」的规则表（试的是列表上这一份，不必先保存）。
   * 用 ref 持同一份引用，省得把整张表塞进回调依赖里、让每次敲键都重建这个回调。
   */
  const ruleSetRef = useRef(ruleSet)
  ruleSetRef.current = ruleSet

  /**
   * 服务端当前生效的那一份 —— 「有没有可保存的改动」以它为基线，保存成功后换成新存的那一份。
   *
   * `null` 表示列表上这份内容不对应任何已保存版本（一版都没存过时的内建默认表），
   * 此时它本身就等于一个「有改动」的状态。
   * 载入完成后才允许保存，避免首屏闪一下可点。
   */
  const [activeRuleSet, setActiveRuleSet] = useState<RouteRuleSet | null>(null)
  const [versions, setVersions] = useState<RouteVersion[]>([])
  /**
   * 保存弹窗的输入初值 —— 「列表上这份内容改自哪一版」的名字与说明。
   *
   * 只跟着内容的来源走：首屏载入是当前生效的那一版，载入历史版本就是载入的那一版，
   * 一版都没存过时是内建默认表自己的名字（就是默认策略那个名字）。
   */
  const [versionDraftDefaults, setVersionDraftDefaults] = useState<VersionDraft>(EMPTY_VERSION_DRAFT)

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  /** 同时只展开一条：展开的是「正在改的那条」，展开多了列表也就不存在了 */
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null)
  /** 刚建出来、还没填过名字的那条：只有它该抢光标 */
  const [freshRuleId, setFreshRuleId] = useState<string | null>(null)
  const [fallbackExpanded, setFallbackExpanded] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RouteRule | null>(null)

  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<RouteRuleRunResult | null>(null)

  /**
   * 预设自带的名字与说明，作为保存弹窗的初值。
   *
   * 预设不是从任何一版改来的，沿用上一版的注记只会误导；但「名字留空」同样不好用：
   * 套用「按客户端来源分流」改完直接保存时，本来就白拿一个说得清的名字与说明。
   * 口径与图模式完全一致。
   */
  const presetDraftDefaults = useCallback((presetId: string | undefined): VersionDraft => {
    const textKeys = presetId ? rulePresetTextKeys(presetId) : undefined
    return textKeys
      ? { name: t(textKeys.name), description: t(textKeys.description) }
      : EMPTY_VERSION_DRAFT
  }, [t])

  /**
   * 首屏从服务端拉一次「当前生效的规则表」与版本列表。
   *
   * 表只有服务端一份：列表打开时看到的就是代理此刻正在执行的那一张；
   * 一版都没保存过时它给的是内建默认表（版本号 `UNSAVED_ROUTE_RULE_VERSION`），
   * 列表因此默认落在「请求的模型命中逻辑模型就直连它」这条规则上，而不是一张空表。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [snapshot, summaries] = await Promise.all([
          unwrap(routerRulesApi.getRules()),
          unwrap(routerRulesApi.getRuleVersions()),
        ])
        if (cancelled) return

        setRuleSet(snapshot.ruleSet)
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
  }, [presetDraftDefaults, toast, t])

  /**
   * 保存 = 发布一个新版本。
   *
   * 服务端把这一版落库并让它立刻对代理生效（一版都没保存过时代理跑的是内建默认表）；
   * 内容与最新版本一致时不会重复生成，避免连点保存堆出一串重复版本。
   *
   * 名字与说明是这一次保存的注记，只在真的生成新版本时才会落库（内容没变时一并丢弃）。
   * 出错时故意不关弹窗：用户刚敲进去的东西不能因为一次网络失败就没地方找回来。
   */
  const saveRules = useCallback(async (draft: VersionDraft) => {
    const ruleSetToSave = ruleSetRef.current
    setSaving(true)
    try {
      const result = await unwrap(routerRulesApi.saveRules(ruleSetToSave, draft.name, draft.description))
      // 存下去的这一版立刻对代理生效，它同时成为「有无改动」的新基线。
      setActiveRuleSet(ruleSetToSave)
      setSaveDialogOpen(false)
      // 列表的来源换成了刚存的这一版，下次打开弹窗要带出来的就是它。
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
  }, [toast, t])

  /**
   * 把历史某一版载入列表。
   *
   * 载入只是「拿到编辑起点」：代理仍然跑着当前生效的那一版，直到这里再点一次「保存」。
   * 展开态与上一次的试跑结果一并清掉 —— 它们对应当前这份内容，换了一版就不再成立。
   */
  const restoreVersion = useCallback(async (version: RouteVersion) => {
    try {
      const snapshot = await unwrap(routerRulesApi.getRuleVersion(version.sequence))
      if (!snapshot) {
        toast.error(t('router.error.versionMissing', { sequence: version.sequence }))
        return
      }
      setRuleSet(snapshot.ruleSet)
      setExpandedRuleId(null)
      setFreshRuleId(null)
      setFallbackExpanded(false)
      setRunResult(null)
      // 列表换成这一版了，保存时默认接着用它的名字与说明。
      setVersionDraftDefaults({ name: version.name, description: version.description })
      toast.success(t('router.toast.versionLoaded', { sequence: version.sequence }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.restoreFailed'))
    }
  }, [toast, t])

  /**
   * 套用内置预设：整张规则表换成预设内容。
   *
   * 预设里没有用户的改动，所以不需要额外确认，但会清掉展开态、待填名的新规则与上次试跑结果 ——
   * 它们对应当前这份内容，换了表就不再成立。保存弹窗的初值换成这张预设自己的名字与说明：
   * 用户改完直接存，就能得到「按客户端来源分流」这样的注记，而不是一个没有名字的版本。
   * 与图模式的 `applyPolicy` 逐一对应。
   */
  const applyPreset = useCallback((preset: RouterRulePreset) => {
    setRuleSet(preset.createRuleSet(runtimeLogicalModels))
    setExpandedRuleId(null)
    setFreshRuleId(null)
    setFallbackExpanded(false)
    setRunResult(null)
    setVersionDraftDefaults(presetDraftDefaults(preset.id))
    const textKeys = rulePresetTextKeys(preset.id)
    toast.success(t('router.toast.presetApplied', { name: textKeys ? t(textKeys.name) : preset.id }))
  }, [presetDraftDefaults, runtimeLogicalModels, toast, t])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const patchRule = useCallback((ruleId: string, patch: Partial<RouteRule>) => {
    setRuleSet(current => ({
      ...current,
      rules: current.rules.map(rule => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    }))
  }, [])

  /**
   * 新建一条规则。
   *
   * 它**追加在最后**：新规则的条件是「UA 包含 Cursor」这种马上可能命中的东西，
   * 插在最前面等于加一条规则就改一次线上分流；放在最后则是什么都不影响，
   * 用户把它拖到哪一格，才是它开始生效的时刻。
   */
  const createRule = useCallback(() => {
    const rule = createRouteRule()
    setRuleSet(current => ({ ...current, rules: [...current.rules, rule] }))
    setExpandedRuleId(rule.id)
    setFreshRuleId(rule.id)
  }, [])

  const toggleExpandRule = useCallback((ruleId: string | null) => {
    setExpandedRuleId(ruleId)
    if (ruleId === null) setFreshRuleId(null)
  }, [])

  /** 复制出一条紧跟在原规则后面的副本：排在原处最容易看出「这两条是一对」。 */
  const duplicateRule = useCallback((ruleId: string) => {
    setRuleSet(current => {
      const index = current.rules.findIndex(rule => rule.id === ruleId)
      if (index < 0) return current

      const source = current.rules[index]
      const copy: RouteRule = {
        ...source,
        id: createId('rule'),
        conditions: source.conditions.map(condition => ({ ...condition })),
        landing: { ...source.landing, logicalModelIds: [...source.landing.logicalModelIds] },
      }
      const rules = [...current.rules]
      rules.splice(index + 1, 0, copy)
      return { ...current, rules }
    })
  }, [])

  const toggleRuleEnabled = useCallback((ruleId: string, enabled: boolean) => {
    patchRule(ruleId, { enabled })
  }, [patchRule])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setRuleSet(current => {
      const from = current.rules.findIndex(rule => rule.id === active.id)
      const to = current.rules.findIndex(rule => rule.id === over.id)
      if (from < 0 || to < 0) return current
      return { ...current, rules: arrayMove(current.rules, from, to) }
    })
  }, [])

  const toggleFallbackModel = useCallback((modelId: string, checked: boolean) => {
    setRuleSet(current => ({
      ...current,
      fallbackModelIds: checked
        ? [...current.fallbackModelIds.filter(id => id !== modelId), modelId]
        : current.fallbackModelIds.filter(id => id !== modelId),
    }))
  }, [])

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return

    const ruleId = deleteTarget.id
    setRuleSet(current => ({ ...current, rules: current.rules.filter(rule => rule.id !== ruleId) }))
    setExpandedRuleId(current => (current === ruleId ? null : current))
    setDeleteTarget(null)
  }, [deleteTarget])

  const payloadRows = useMemo(
    () => Math.min(28, Math.max(8, payloadText.split('\n').length + 1)),
    [payloadText],
  )

  /**
   * 试跑走服务端。
   *
   * 条件里的头名匹配、可变落点的取值语义都由引擎一处实现，界面拿到的判定过程与代理真实执行的完全一致 ——
   * 前端再实现一遍「差不多」的匹配，迟早会出现「试跑命中、线上没命中」。
   */
  const runLocalTest = useCallback(async () => {
    let payload: unknown
    try {
      payload = JSON.parse(payloadText)
    } catch {
      setRunResult(null)
      setPayloadError(t('router.error.invalidPayload'))
      return
    }

    const normalizedPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    // 逻辑模型列表由控制台注入：它是本地配置，请求体里本来没有。
    normalizedPayload.logicalModels = runtimeLogicalModels

    try {
      setPayloadError('')
      setRunResult(await unwrap(routerRulesApi.run(ruleSetRef.current, normalizedPayload)))
    } catch (error) {
      setRunResult(null)
      setPayloadError(error instanceof Error ? error.message : String(error))
    }
  }, [payloadText, runtimeLogicalModels, t])

  const atLimit = ruleSet.rules.length >= MAX_ROUTE_RULES

  /** 当前规则表与哪个预设一致（不一致时为 null）。比对口径与图模式相同。 */
  const activePresetId = useMemo(
    () => ROUTER_RULE_PRESETS.find(preset => isSameRouteRuleSet(preset.createRuleSet(runtimeLogicalModels), ruleSet))?.id ?? null,
    [ruleSet, runtimeLogicalModels],
  )

  /**
   * 列表相对「当前生效的那一版」有改动才允许保存。
   *
   * 内容一致时后端本来就不会生成新版本，但按钮常亮会让人以为随时有东西要存；
   * 这里把「有没有可保存的改动」直接做成可用状态，就是保存按钮的语义本身 ——
   * 与图模式完全同一个口径，两个模式不需要各自的「我改了没」提示。
   */
  const canSave = loaded && !saving && (activeRuleSet === null || !isSameRouteRuleSet(activeRuleSet, ruleSet))

  /** 这一次保存会拿到的版本号（版本列表为空时就是首版）。 */
  const nextVersion = (versions[0]?.sequence ?? 0) + 1

  return (
    <PageLayout>
      <PageHeader
        title={t('router.rules.title')}
        // 模式切换紧跟在标题后面：它在回答「这个标题指的是哪一种定义」，而不是一个页面动作。
        titleAdornment={<RouteModeSwitch />}
        description={t('router.rules.description')}
        // 说明文案保持单行截断：标题栏高度固定，下面的列表位置才不会随文案换行跳动。
        className="[&_p]:truncate"
        actions={(
          // 标题栏不提供 gap，按钮之间得自己隔开。五个动作从左到右是「预设 → 编辑 → 验证 → 发布 → 回滚」，
          // 与图模式摆同一个次序：预设都在最前，换个模式不用重新找按钮。
          <div className="flex items-center gap-2">
            <RulesPresetMenu activePresetId={activePresetId} onApply={applyPreset} />
            <WorkflowButton size="medium" disabled={atLimit} onClick={createRule}>
              <Plus className="size-3.5" aria-hidden /> {t('router.rules.add')}
            </WorkflowButton>
            <WorkflowButton size="medium" onClick={() => setTestDrawerOpen(true)}>
              <CirclePlay className="size-3.5" aria-hidden /> {t('router.rules.run.open')}
            </WorkflowButton>
            <WorkflowButton size="medium" variant="primary" disabled={!canSave} onClick={() => setSaveDialogOpen(true)}>
              <Save className="size-3.5" aria-hidden /> {t('router.save')}
            </WorkflowButton>
            <VersionMenu versions={versions} itemUnitKey="router.version.unit.rules" onRestore={restoreVersion} />
          </div>
        )}
      />

      <PageContent>
        {loaded
          ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <RulesList
                ruleSet={ruleSet}
                logicalModels={logicalModels}
                expandedRuleId={expandedRuleId}
                fallbackExpanded={fallbackExpanded}
                freshRuleId={freshRuleId}
                onCreate={createRule}
                onToggleExpandRule={toggleExpandRule}
                onToggleFallback={() => setFallbackExpanded(value => !value)}
                onPatchRule={patchRule}
                onDuplicate={duplicateRule}
                onDelete={ruleId => setDeleteTarget(ruleSet.rules.find(rule => rule.id === ruleId) ?? null)}
                onToggleEnabled={toggleRuleEnabled}
                onToggleFallbackModel={toggleFallbackModel}
              />
            </DndContext>
          )
          : <div className="flex justify-center py-24"><Spinner /></div>}
      </PageContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('router.rules.delete.title')}
        description={deleteTarget
          ? `${deleteTarget.name || t('router.rules.unnamed')} · ${t('router.rules.delete.description')}`
          : ''}
        confirmLabel={t('router.rules.delete.confirm')}
        variant="destructive"
        onConfirm={confirmDelete}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
      />

      <RulesRunDrawer
        open={testDrawerOpen}
        onOpenChange={setTestDrawerOpen}
        ruleSet={ruleSet}
        unsaved={canSave}
        payloadText={payloadText}
        onPayloadTextChange={setPayloadText}
        payloadRows={payloadRows}
        payloadError={payloadError}
        result={runResult}
        onRun={() => void runLocalTest()}
      />

      {/* 弹窗挂在列表之外：它只负责收集名字与说明，规则表仍然由页面这一层持有。 */}
      <SaveVersionDialog
        open={saveDialogOpen}
        nextVersion={nextVersion}
        description={t('router.saveDialog.descriptionRules')}
        initialName={versionDraftDefaults.name}
        initialDescription={versionDraftDefaults.description}
        saving={saving}
        onOpenChange={setSaveDialogOpen}
        onConfirm={draft => void saveRules(draft)}
      />
    </PageLayout>
  )
}
