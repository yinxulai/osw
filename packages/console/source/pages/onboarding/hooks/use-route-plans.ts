import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { routerApi } from '@/api/router'
import { routerRulesApi } from '@/api/router-rules'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import { POLICY_PRESET_TEXT_KEYS } from '@/pages/router/policy-preset-text'
import { RULE_PRESET_TEXT_KEYS } from '@/pages/router/rules/rules-preset-text'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { ROUTER_POLICY_PRESETS, isSameGraph } from '@common/router/presets'
import { ROUTER_RULE_PRESETS } from '@common/router/rule-presets'
import { isSameRouteRuleSet } from '@common/router/route-rules'
import type { RouteMode } from '@common/schemas'

/** 列表里的一项「方案」：一个内置预设的展示文案 + 它是不是系统内建的默认方案。 */
export interface RoutePlanOption {
  id: string
  isDefault: boolean
  nameKey: UiCatalogKey
  descriptionKey: UiCatalogKey
}

export interface RoutePlansState {
  options: readonly RoutePlanOption[]
  /** 「内置默认」角标文案。两个模式各有一个键（正文措辞不同），不合并。 */
  builtInDefaultKey: UiCatalogKey
  /** 「当前」标记文案，同上。 */
  currentKey: UiCatalogKey
  /** 此刻生效的那份定义与哪个方案逐字节一致；对不上任何方案（或还没读到）时为 `null`。 */
  activeId: string | null
  /** 正在保存的方案 id；保存期间整张表都不可点，免得连点存出两版。 */
  applyingId: string | null
  loading: boolean
  apply: (id: string) => void
}

/**
 * 两个模式各自的内置方案清单。
 *
 * 文案键直接取自各自工作台上的那张映射表（`RULE_PRESET_TEXT_KEYS` / `POLICY_PRESET_TEXT_KEYS`）——
 * 引导页里看到的「UA 区分来源」，与路由页下拉菜单里的必须是同一句话；
 * 各写一份的结果就是两边慢慢说得不一样。
 */
function rulePlanOptions(): RoutePlanOption[] {
  return ROUTER_RULE_PRESETS.map(preset => {
    const keys = RULE_PRESET_TEXT_KEYS[preset.id]
    return { id: preset.id, isDefault: preset.isDefault, nameKey: keys.name, descriptionKey: keys.description }
  })
}

function policyPlanOptions(): RoutePlanOption[] {
  return ROUTER_POLICY_PRESETS.map(preset => {
    const keys = POLICY_PRESET_TEXT_KEYS[preset.id]
    return { id: preset.id, isDefault: preset.isDefault, nameKey: keys.name, descriptionKey: keys.description }
  })
}

/**
 * 「选路」这一步可以直接套用的内置方案。
 *
 * 与两个工作台的关系：这里**不是**在编辑草稿，而是把选定方案直接保存成一个新版本
 * （`saveRules` / `saveGraph`，内容与最新版一致时服务端不重复生成）。
 * 引导页没有「草稿 → 保存」这一段：用户此刻要的就是「先有个能跑的骨架」，
 * 让他点完还要再去另一个页面按一次保存，等于把这一步做成了一句提示。
 *
 * 方案按当前模式取：规则模式列规则预设、编排模式列策略预设。两个模式的定义互不相干，
 * 列另一边的方案只会让人以为套上就会生效。落点由预设自己按当下的逻辑模型列表定好
 * （`createPresetModelPool`），所以套完即可运行 —— 一个逻辑模型都没有时退回内建默认 `default`。
 */
export function useRoutePlans(mode: RouteMode): RoutePlansState {
  const t = useTranslation()
  const toast = useToast()
  const logicalModels = useLogicalModels()

  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })),
    [logicalModels],
  )

  /**
   * 比对用的逻辑模型列表走 ref：换一批模型并不改变「当前套的是哪个方案」这个问题已经得到的答案，
   * 却会让下面那个 effect 重跑、把「当前」标记闪掉一次。只在真正载入一次时读它。
   */
  const modelsRef = useRef(runtimeLogicalModels)
  modelsRef.current = runtimeLogicalModels

  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  /**
   * 载入「此刻生效的那份定义」，比对出它对应哪个方案。
   *
   * 读的是服务端那一份，不是本地缓存：一版都没保存过时它给的是内建默认定义，
   * 于是首屏就落在「逻辑模型命中」这一项上，而不是四项都没选中。
   */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const models = modelsRef.current
        if (mode === 'rules') {
          const snapshot = await unwrap(routerRulesApi.getRules())
          if (cancelled) return
          const matched = ROUTER_RULE_PRESETS.find(preset =>
            isSameRouteRuleSet(preset.createRuleSet(models), snapshot.ruleSet),
          )
          setActiveId(matched?.id ?? null)
        } else {
          const snapshot = await unwrap(routerApi.getGraph())
          if (cancelled) return
          const matched = ROUTER_POLICY_PRESETS.find(preset =>
            isSameGraph(preset.createGraph(models), snapshot.graph),
          )
          setActiveId(matched?.id ?? null)
        }
      } catch {
        // 读不到就当作「当前不对应任何方案」：这一步是锦上添花，不该把引导页拦在这里。
        if (!cancelled) setActiveId(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode])

  const apply = useCallback((id: string) => {
    if (applyingId !== null) return

    void (async () => {
      setApplyingId(id)
      try {
        if (mode === 'rules') {
          const preset = ROUTER_RULE_PRESETS.find(item => item.id === id)
          if (!preset) return
          const keys = RULE_PRESET_TEXT_KEYS[preset.id]
          const result = await unwrap(
            routerRulesApi.saveRules(preset.createRuleSet(modelsRef.current), t(keys.name), t(keys.description)),
          )
          setActiveId(preset.id)
          if (result.created) {
            toast.success(t('onboarding.step.routeMode.planApplied', { name: t(keys.name), version: result.version }))
          } else {
            toast.info(t('router.toast.identicalToLatest', { version: result.version }))
          }
          return
        }

        const preset = ROUTER_POLICY_PRESETS.find(item => item.id === id)
        if (!preset) return
        const keys = POLICY_PRESET_TEXT_KEYS[preset.id]
        const result = await unwrap(
          routerApi.saveGraph(preset.createGraph(modelsRef.current), t(keys.name), t(keys.description)),
        )
        setActiveId(preset.id)
        if (result.created) {
          toast.success(t('onboarding.step.routeMode.planApplied', { name: t(keys.name), version: result.version }))
        } else {
          toast.info(t('router.toast.identicalToLatest', { version: result.version }))
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('router.error.saveFailed'))
      } finally {
        setApplyingId(null)
      }
    })()
  }, [applyingId, mode, t, toast])

  const options = useMemo(() => (mode === 'rules' ? rulePlanOptions() : policyPlanOptions()), [mode])

  return {
    options,
    builtInDefaultKey: mode === 'rules' ? 'router.rules.preset.builtInDefault' : 'router.policy.builtInDefault',
    currentKey: mode === 'rules' ? 'router.rules.preset.current' : 'router.policy.current',
    activeId,
    applyingId,
    loading,
    apply,
  }
}
