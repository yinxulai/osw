import { useMemo } from 'react'
import { CirclePlay, Plus, Save } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'

import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Spinner } from '@/components/ui/spinner'
import { useLogicalModels } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import { RouteModeSwitch } from '../components/route-mode-switch'
import { SaveVersionDialog } from '../components/save-version-dialog'
import { VersionMenu } from '../components/version-menu'
import { WorkflowButton } from '../components/workflow-button'
import { builtinRouteRuleName } from './builtin-rule-name'
import { RulesList } from './rules-list'
import { RulesPresetMenu } from './rules-preset-menu'
import { RulesRunDrawer } from './rules-run-drawer'
import { useRuleSetEditing } from './use-rule-set-editing'
import { useRuleTestRun } from './use-rule-test-run'
import { useRuleVersioning } from './use-rule-versioning'

/**
 * 规则模式的工作台。
 *
 * 它和图模式的工作台是**两个页面**：共用 `PageLayout` / `PageHeader` 与保存弹窗、版本列表这些外壳，
 * 但正文、编辑方式、试跑结果全部各写各的。
 *
 * 状态按功能拆成三个内聚的 hook —— 规则表草稿编辑（`useRuleSetEditing`）、版本生命周期
 * （`useRuleVersioning`）、试跑（`useRuleTestRun`），它们都可脱离这棵组件树单测；版本层通过
 * `loadRuleSet` / `clearRunResult` 两个回调与另外两块衔接。这一层只把它们摆进外壳里组合渲染。
 */
export function RouteRulesStudio() {
  const t = useTranslation()
  const logicalModels = useLogicalModels()
  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ modelId: model.modelId, description: model.description, enabled: model.enabled })),
    [logicalModels],
  )

  const editing = useRuleSetEditing(runtimeLogicalModels)
  const test = useRuleTestRun(editing.ruleSetRef, runtimeLogicalModels)
  const versioning = useRuleVersioning({
    ruleSet: editing.ruleSet,
    ruleSetRef: editing.ruleSetRef,
    runtimeLogicalModels,
    loadRuleSet: editing.loadRuleSet,
    clearRunResult: test.clearResult,
  })

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
          // 标题栏不提供 gap，按钮之间得自己隔开。五个动作从左到右是「预设 → 编辑 → 验证 → 发布 → 回滚」。
          <div className="flex items-center gap-2">
            <RulesPresetMenu activePresetId={editing.activePresetId} onApply={versioning.applyPreset} />
            <WorkflowButton size="medium" disabled={editing.atLimit} onClick={editing.createRule}>
              <Plus className="size-3.5" aria-hidden /> {t('router.rules.add')}
            </WorkflowButton>
            <WorkflowButton size="medium" onClick={() => test.setOpen(true)}>
              <CirclePlay className="size-3.5" aria-hidden /> {t('router.rules.run.open')}
            </WorkflowButton>
            <WorkflowButton size="medium" variant="primary" disabled={!versioning.canSave} onClick={() => versioning.setSaveDialogOpen(true)}>
              <Save className="size-3.5" aria-hidden /> {t('router.save')}
            </WorkflowButton>
            <VersionMenu versions={versioning.versions} itemUnitKey="router.version.unit.rules" onRestore={versioning.restoreVersion} />
          </div>
        )}
      />

      <PageContent>
        {versioning.loaded
          ? (
            <DndContext sensors={editing.sensors} collisionDetection={closestCenter} onDragEnd={editing.handleDragEnd}>
              <RulesList
                ruleSet={editing.ruleSet}
                logicalModels={logicalModels}
                expandedRuleId={editing.expandedRuleId}
                fallbackExpanded={editing.fallbackExpanded}
                freshRuleId={editing.freshRuleId}
                onCreate={editing.createRule}
                onToggleExpandRule={editing.toggleExpandRule}
                onToggleFallback={editing.toggleFallback}
                onPatchRule={editing.patchRule}
                onDuplicate={editing.duplicateRule}
                onDelete={editing.requestDelete}
                onToggleEnabled={editing.toggleRuleEnabled}
                onToggleFallbackModel={editing.toggleFallbackModel}
              />
            </DndContext>
          )
          : <div className="flex justify-center py-24"><Spinner /></div>}
      </PageContent>

      <ConfirmDialog
        open={editing.deleteTarget !== null}
        title={t('router.rules.delete.title')}
        description={editing.deleteTarget
          ? `${builtinRouteRuleName(editing.deleteTarget, t) || t('router.rules.unnamed')} · ${t('router.rules.delete.description')}`
          : ''}
        confirmLabel={t('router.rules.delete.confirm')}
        variant="destructive"
        onConfirm={editing.confirmDelete}
        onOpenChange={open => { if (!open) editing.dismissDelete() }}
      />

      <RulesRunDrawer
        open={test.open}
        onOpenChange={test.setOpen}
        ruleSet={editing.ruleSet}
        unsaved={versioning.canSave}
        payloadText={test.payloadText}
        onPayloadTextChange={test.setPayloadText}
        payloadRows={test.rows}
        payloadError={test.payloadError}
        result={test.result}
        onRun={() => void test.run()}
      />

      {/* 弹窗挂在列表之外：它只负责收集名字与说明，规则表仍然由编辑层持有。 */}
      <SaveVersionDialog
        open={versioning.saveDialogOpen}
        nextVersion={versioning.nextVersion}
        description={t('router.saveDialog.descriptionRules')}
        initialName={versioning.versionDraftDefaults.name}
        initialDescription={versioning.versionDraftDefaults.description}
        saving={versioning.saving}
        onOpenChange={versioning.setSaveDialogOpen}
        onConfirm={draft => void versioning.saveRules(draft)}
      />
    </PageLayout>
  )
}
