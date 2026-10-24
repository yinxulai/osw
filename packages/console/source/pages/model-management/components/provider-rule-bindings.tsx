import { useEffect, useMemo, useState } from 'react'
import { GripVertical, Plus, ScrollText, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useBoundRules, saveProviderModelRuleBindings } from '@/data/rule-bindings'
import { useTranslation } from '@/i18n/provider'
import {
  appendBoundRules,
  filterRulesByKeyword,
  removeBoundRule,
  ruleStagesOf,
  toggleBoundRule,
} from '@/lib/rule-bindings'
import type { BoundRule } from '@/lib/rule-bindings'

interface ProviderRuleBindingsProps {
  providerModelId: string
  embedded?: boolean
}

/**
 * 一个供应商模型上绑定了哪些请求重写规则。
 *
 * 这个组件只做三件事：画行、记「弹窗开着没有 / 选了哪几条」、把改动交给
 * `saveProviderModelRuleBindings`。取数、全局规则排序、两个开关的「与」关系、
 * 「已绑的不进候选」全在 `data/rule-bindings.ts` 与 `lib/rule-bindings.ts` 里——
 * 那些是业务规则，测试它们不需要渲染一棵 React 树。
 */
export function ProviderRuleBindings(props: ProviderRuleBindingsProps) {
  const { providerModelId, embedded = false } = props
  const t = useTranslation()
  const toast = useToast()
  const { rules: loadedRules, availableRules, loading, error } = useBoundRules(providerModelId)
  /*
   * 本地副本：改动先落在界面上，再发请求。
   *
   * 直接渲染 `loadedRules` 会让每次开关都等一个往返才动，手感像卡住。`key` 用
   * `providerModelId`：换一个模型时把副本丢掉，不会把上一个模型的绑定带过来。
   */
  const [draft, setDraft] = useState<{ key: string; rules: BoundRule[] } | null>(null)
  const rules = draft?.key === providerModelId ? draft.rules : loadedRules
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([])
  const [ruleSearch, setRuleSearch] = useState('')

  const filteredRules = useMemo(
    () => filterRulesByKeyword(availableRules, ruleSearch),
    [availableRules, ruleSearch],
  )

  // 取数失败要当场说一声：这块区域本身只会画出「加载失败」，用户不可能自己发现是哪个
  // 接口挂了。空串表示「失败了但拿不到原因」，那时不拼原因、只用兜底文案——`toEqual('')`
  // 这种「写了个空提示」的做法比不提示更糟。
  useEffect(() => {
    if (error === null) return
    toast.error(t('models.rules.loadError', { message: error || t('common.label.unknownError') }))
  }, [error, toast, t])

  const persist = (next: BoundRule[]) => {
    setDraft({ key: providerModelId, rules: next })
    void saveProviderModelRuleBindings(providerModelId, next).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : t('common.label.unknownError')
      toast.error(t('models.rules.loadError', { message }))
    })
  }

  const addRules = () => {
    const selected = availableRules.filter(rule => selectedRuleIds.includes(rule.id))
    if (selected.length === 0) return
    persist(appendBoundRules(rules, selected.map(rule => ({
      id: rule.id,
      name: rule.name,
      stages: ruleStagesOf(rule),
      enabled: rule.enabled,
      global: false,
    }))))
    setSelectedRuleIds([])
    setRuleSearch('')
    setAddDialogOpen(false)
  }

  return (
    <section className={embedded ? 'grid gap-3 pt-1' : 'mt-5 grid gap-3 pt-4'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="system-sm-medium text-text-primary">{t('models.rules.title')}</h3>
            <Badge variant="muted" className="font-normal">{t('models.rules.count', { count: rules.length })}</Badge>
          </div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">
            {t('models.rules.description')}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAddDialogOpen(true)} disabled={loading || Boolean(error) || availableRules.length === 0}>
          <Plus /> {t('models.rules.add')}
        </Button>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={open => { setAddDialogOpen(open); if (!open) { setSelectedRuleIds([]); setRuleSearch('') } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('models.rules.addDialogTitle')}</DialogTitle>
            <DialogDescription>{t('models.rules.addDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-3.5 text-text-tertiary" aria-hidden />
            <Input value={ruleSearch} onChange={event => setRuleSearch(event.target.value)} placeholder={t('models.rules.searchPlaceholder')} className="pl-9" />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredRules.length > 0 ? filteredRules.map(rule => {
              const checked = selectedRuleIds.includes(rule.id)
              const stages = ruleStagesOf(rule)
              return <label key={rule.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg px-3 py-2.5 hover:bg-state-base-hover-alt">
                <Checkbox checked={checked} onCheckedChange={value => setSelectedRuleIds(ids => value ? [...ids, rule.id] : ids.filter(id => id !== rule.id))} />
                <span className="min-w-0 flex-1"><span className="block truncate system-xs-medium text-text-primary">{rule.name}</span><span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{rule.description || t('rules.table.noDescription')}</span></span>
                <span className="flex shrink-0 gap-1">{stages.map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? t('rules.stage.request') : t('rules.stage.response')}</Badge>)}</span>
              </label>
            }) : <p className="py-8 text-center system-xs-regular text-text-tertiary">{t('models.rules.emptyAddable')}</p>}
          </div>
          <DialogFooter>
            <span className="mr-auto system-xs-regular text-text-tertiary">{t('models.rules.selectedCount', { count: selectedRuleIds.length })}</span>
            <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>{t('common.action.cancel')}</Button>
            <Button type="button" onClick={addRules} disabled={selectedRuleIds.length === 0}>{t('models.rules.confirmAdd')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-module-border bg-workflow-block-parma-bg">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-2 px-3 py-2.5 not-last:border-b not-last:border-border/40">
              <button type="button" aria-label={t('models.rules.reorderAria', { name: rule.name })} className="cursor-grab text-text-quaternary">
                <GripVertical className="size-3.5" />
              </button>
              <span className="flex size-5 items-center justify-center rounded-md bg-card system-2xs-medium text-text-tertiary">{index + 1}</span>
              <ScrollText className="size-3.5 text-text-tertiary" aria-hidden />
              <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{rule.name}</span>
              {rule.stages.map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? t('rules.stage.request') : t('rules.stage.response')}</Badge>)}
              {rule.global ? <Badge variant="muted" className="font-normal">{t('models.rules.globalBadge')}{!rule.enabled && t('models.rules.globalDisabledSuffix')}</Badge> : <>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={enabled => persist(toggleBoundRule(rules, rule.id, enabled))}
                  aria-label={t('models.rules.toggleAria', { name: rule.name })}
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => persist(removeBoundRule(rules, rule.id))} aria-label={t('models.rules.removeAria', { name: rule.name })} className="text-text-tertiary hover:text-text-destructive">
                  <Trash2 />
                </Button>
              </>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg px-4 py-6 text-center">
          <p className="system-xs-medium text-text-primary">{t('models.rules.emptyTitle')}</p>
          <p className="mt-1 system-2xs-regular text-text-tertiary">
            {error ? t('models.rules.loadFailed') : availableRules.length === 0 && !loading ? t('models.rules.createFirst') : t('models.rules.globalOnly')}
          </p>
        </div>
      )}
    </section>
  )
}
