import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from '@/i18n/provider'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RulePresetMenu } from './components/rule-preset-menu'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { useRewriteRules } from './hooks/use-rewrite-rules'

export function RequestRewriteRulesPage() {
  const t = useTranslation()
  const rules = useRewriteRules()

  return (
    <PageLayout>
      <PageHeader
        title={t('rules.title')}
        description={t('rules.description')}
        actions={(
          <div className="flex items-center gap-2">
            <RulePresetMenu onCreateBlank={rules.addRule} onCreateFromPreset={rules.addRuleFromPreset} />
          </div>
        )}
      />
      <PageContent>
        {rules.loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{rules.loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void rules.loadRules()}>{t('common.action.retry')}</Button>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2 system-xs-regular text-text-tertiary">
          <ShieldCheck className="size-3.5 shrink-0 text-info" />
          {t('rules.notice')}
        </div>
        <RuleStats rules={rules.rules} />
        <RulesTable
          rules={rules.filteredRules}
          search={rules.search}
          statusFilter={rules.statusFilter}
          onSearchChange={rules.setSearch}
          onStatusFilterChange={rules.setStatusFilter}
          onEdit={rules.editRule}
          onDuplicate={rules.duplicateRule}
          onDelete={rules.setDeleteTarget}
          onToggle={rules.toggleRule}
        />
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
          open={Boolean(rules.deleteTarget)}
          title={t('rules.delete.title', { name: rules.deleteTarget?.name ?? '' })}
          description={t('rules.delete.description')}
          confirmLabel={t('rules.delete.confirm')}
          variant="destructive"
          onConfirm={() => rules.deleteTarget && rules.deleteRule(rules.deleteTarget)}
          onOpenChange={open => !open && rules.setDeleteTarget(null)}
        />
      </PageContent>
    </PageLayout>
  )
}
