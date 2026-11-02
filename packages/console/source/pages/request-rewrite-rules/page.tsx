import { Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import { AsyncState } from '@/components/async-state'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from '@/i18n/provider'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RulePresetMenu } from './components/rule-preset-menu'
import { RuleStats } from './components/rule-stats'
import { RulesNotice } from './components/rules-notice'
import { RulesTable, RulesTableSkeleton } from './components/rules-table'
import { useRewriteRules } from './hooks/use-rewrite-rules'

export function RequestRewriteRulesPage() {
  const t = useTranslation()
  const rules = useRewriteRules()
  const hasRules = rules.rules.length > 0
  // 已有数据时的刷新失败不该把表盖掉；只有首屏读不到才进入整块错误态。
  const blockingError = hasRules ? null : rules.loadError

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('rules.title')}
        description={t('rules.description')}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <RulePresetMenu onCreateBlank={rules.addRule} onCreateFromPreset={rules.addRuleFromPreset} />
          </div>
        )}
      />
      <PageContent className="flex min-h-0 flex-1 flex-col">
        {rules.loadError && hasRules && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{rules.loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void rules.loadRules()}>{t('common.action.retry')}</Button>
          </div>
        )}
        <RulesNotice />

        {hasRules ? <RuleStats rules={rules.rules} /> : null}

        <AsyncState
          loading={rules.loading}
          error={blockingError}
          errorTitle={t('rules.loadFailed')}
          onRetry={() => void rules.loadRules()}
          empty={!hasRules}
          embedded
          className="min-h-0 flex-1"
          loadingFallback={<RulesTableSkeleton />}
          emptyState={{
            icon: ShieldCheck,
            title: t('rules.empty.title'),
            description: t('rules.empty.description'),
            action: (
              <Button onClick={rules.addRule}>
                <Plus size={14} />
                {t('rules.create')}
              </Button>
            ),
          }}
        >
          <RulesTable
            rules={rules.filteredRules}
            search={rules.search}
            statusFilter={rules.statusFilter}
            hasAnyRules={hasRules}
            onSearchChange={rules.setSearch}
            onStatusFilterChange={rules.setStatusFilter}
            onEdit={rules.editRule}
            onDuplicate={rules.duplicateRule}
            onDelete={rules.setDeleteTarget}
            onToggle={rules.toggleRule}
            onCreate={rules.addRule}
            onClearFilters={() => {
              rules.setSearch('')
              rules.setStatusFilter('all')
            }}
          />
        </AsyncState>

        <RuleEditorDialog
          open={rules.editorOpen}
          rule={rules.draft}
          dirty={rules.dirty}
          onOpenChange={rules.setEditorOpen}
          onChange={rules.setDraft}
          onSave={rules.saveRule}
          onReset={() => rules.savedRule && rules.setDraft(rules.savedRule)}
        />
        <ConfirmDialog
          open={rules.deleteTarget !== null}
          onOpenChange={open => { if (!open) rules.setDeleteTarget(null) }}
          title={t('rules.delete.title', { name: rules.deleteTarget?.name ?? '' })}
          description={t('rules.delete.description')}
          confirmLabel={t('rules.delete.confirm')}
          variant="destructive"
          onConfirm={() => rules.deleteTarget && rules.deleteRule(rules.deleteTarget)}
        />
      </PageContent>
    </PageLayout>
  )
}
