import { CirclePlay, Save } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { PageHeader } from '@/components/layout'
import type { RouterPolicyPreset, RouterPolicyPresetId } from '@common/router/presets'
import type { RouteVersion } from '../route-versions'
import { PolicyMenu } from './policy-menu'
import { RouteModeSwitch } from './route-mode-switch'
import { VersionMenu } from './version-menu'
import { WorkflowButton } from './workflow-button'

interface WorkflowStudioHeaderProps {
  /** 当前画布与哪个预设一致；`null` 表示已经被改过。 */
  activePolicyId: RouterPolicyPresetId | null
  /** 有可保存的改动、且不在保存中。 */
  canSave: boolean
  versions: readonly RouteVersion[]
  onApplyPolicy: (preset: RouterPolicyPreset) => void
  onRestoreVersion: (version: RouteVersion) => void
  onOpenRun: () => void
  onOpenSave: () => void
}

/**
 * 工作台页头：标题、模式切换，以及四个动作（预设 / 试运行 / 保存 / 历史版本）。
 *
 * 动作的可用状态全部由外传入（`canSave` 由页面按「画布与当前生效的一版是否一致」算好），
 * 这里不判断能否保存——那个判断需要整张图，不是页头该知道的事。
 */
export function WorkflowStudioHeader(props: WorkflowStudioHeaderProps) {
  const t = useTranslation()

  return (
    <PageHeader
      title={t('router.workflow.title')}
      // 模式切换紧跟在标题后面：它在回答「这个标题指的是哪一种定义」，而不是一个页面动作。
      titleAdornment={<RouteModeSwitch />}
      description={t('router.workflow.description')}
      // 说明文案保持单行截断：标题栏高度固定，画布高度才不会随文案换行变化。
      className="[&_p]:truncate"
      actions={(
        // 标题栏不提供 gap，两个按钮直接放在 Fragment 里会贴在一起。
        <div className="flex items-center gap-2">
          <PolicyMenu activePolicyId={props.activePolicyId} onApply={props.onApplyPolicy} />
          <WorkflowButton size="medium" onClick={props.onOpenRun}>
            <CirclePlay className="size-3.5" aria-hidden /> {t('router.workflow.run')}
          </WorkflowButton>
          <WorkflowButton size="medium" variant="primary" onClick={props.onOpenSave} disabled={!props.canSave}>
            <Save className="size-3.5" aria-hidden /> {t('router.save')}
          </WorkflowButton>
          <VersionMenu versions={[...props.versions]} itemUnitKey="router.version.unit.nodes" onRestore={props.onRestoreVersion} />
        </div>
      )}
    />
  )
}
