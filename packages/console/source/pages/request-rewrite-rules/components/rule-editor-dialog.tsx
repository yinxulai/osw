import { useState } from 'react'
import { FlaskConical, ListFilter, LoaderCircle, PencilLine, Plus, Save, Trash2 } from 'lucide-react'
import { requestRewriteRuleApi } from '@/api/models'
import { FormField } from '@/components/form-kit'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { RuleEditor } from './rule-editor'
import { parseJsonActionValue, type RequestRewriteRule, type RuleTestCase } from '../types'
import type { RequestRewriteRule as ApiRequestRewriteRule } from '@common/schemas'

interface RuleTestResult {
  body: string
  headers: Record<string, string | string[] | undefined>
  appliedRuleIds: string[]
  skippedRuleIds: string[]
}

interface RuleEditorDialogProps {
  open: boolean
  rule: RequestRewriteRule
  dirty: boolean
  onOpenChange: (open: boolean) => void
  onChange: (rule: RequestRewriteRule) => void
  onSave: () => void
  onReset: () => void
}

export function RuleEditorDialog(props: RuleEditorDialogProps) {
  const t = useTranslation()
  const toast = useToast()
  const [testResults, setTestResults] = useState<Record<string, RuleTestResult>>({})
  const [testingId, setTestingId] = useState<string>()
  const [deleteTestCaseId, setDeleteTestCaseId] = useState<string>()

  const updateTestCases = (testCases: RuleTestCase[]) => props.onChange({ ...props.rule, testCases })
  const defaultTestInput = (stage: RuleTestCase['stage']) => stage === 'response'
    ? { body: '{\n  "id": "response-demo",\n  "choices": [{ "message": { "role": "assistant", "content": "hello" } }]\n}', headers: '{\n  "content-type": "application/json",\n  "x-upstream-status": "200"\n}' }
    : { body: '{\n  "model": "demo",\n  "messages": [{ "role": "user", "content": "hello" }]\n}', headers: '{\n  "content-type": "application/json"\n}' }
  const addTestCase = () => {
    const id = `test-${Date.now()}`
    const input = defaultTestInput('request')
    const testCase: RuleTestCase = { id, name: t('rules.tests.defaultName', { index: props.rule.testCases.length + 1 }), stage: 'request', ...input, clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', transport: 'http' }
    updateTestCases([...props.rule.testCases, testCase])
  }
  const updateTestCase = (id: string, patch: Partial<RuleTestCase>) => {
    updateTestCases(props.rule.testCases.map(testCase => testCase.id === id ? { ...testCase, ...patch } : testCase))
  }
  const removeTestCase = (id: string) => {
    updateTestCases(props.rule.testCases.filter(testCase => testCase.id !== id))
    setTestResults(results => {
      const next = { ...results }
      delete next[id]
      return next
    })
  }

  const runTest = (testCase: RuleTestCase) => {
    setTestingId(testCase.id)
    const rule: ApiRequestRewriteRule = {
      id: props.rule.id,
      name: props.rule.name,
      description: props.rule.description,
      enabled: props.rule.enabled,
      scope: props.rule.global ? 'global' : 'model',
      schemaVersion: 1,
      // 试跑用的临时报文：取值与保存时一致，免得两处对「这条规则是什么」说法不同。
      source: props.rule.source,
      match: { clientProtocols: props.rule.match.clientProtocols as ApiRequestRewriteRule['match']['clientProtocols'], upstreamProtocols: props.rule.match.upstreamProtocols as ApiRequestRewriteRule['match']['upstreamProtocols'] },
      testCases: [],
      actions: props.rule.actions.map(action => action.target === 'header'
        ? action.operation === 'remove' ? { type: 'header-remove', stage: action.stage, name: action.path } : { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
        : action.operation === 'remove' ? { type: 'body-delete', stage: action.stage, path: action.path } : action.operation === 'replace' ? { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false } : { type: 'body-set', stage: action.stage, path: action.path, value: parseJsonActionValue(action.value) }),
      createdTime: 0,
      updatedTime: 0,
      deletedTime: null,
    }
    void requestRewriteRuleApi.test(rule, testCase).then(response => {
      if (!response.success) toast.error(response.errorMessage)
      else setTestResults(results => ({ ...results, [testCase.id]: response.data }))
      setTestingId(undefined)
    })
  }

  const close = () => props.onOpenChange(false)
  const cancel = () => {
    if (props.dirty) props.onReset()
    close()
  }
  return (
    <Sheet open={props.open} onOpenChange={open => open ? props.onOpenChange(true) : cancel()}>
      <SheetContent
        side="right"
        className="flex h-full w-full! max-w-3xl! flex-col gap-0 border-0 bg-card p-0 text-card-foreground shadow-none"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <SheetHeader className="shrink-0 px-4 py-3.5 pr-12">
          <SheetTitle className="system-md-semibold">{props.rule.updatedTime === null ? t('rules.editor.newTitle') : t('rules.editor.editTitle')}</SheetTitle>
          <SheetDescription className="system-xs-regular text-text-tertiary">{t('rules.editor.description')}</SheetDescription>
        </SheetHeader>

        <nav aria-label={t('rules.editor.navAria')} className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 px-4 py-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 system-xs-medium" onClick={() => document.getElementById('rule-overview')?.scrollIntoView({ behavior: 'smooth' })}><PencilLine />{t('rules.editor.nav.overview')}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 system-xs-medium" onClick={() => document.getElementById('rule-match')?.scrollIntoView({ behavior: 'smooth' })}><ListFilter />{t('rules.editor.nav.match')}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 system-xs-medium" onClick={() => document.getElementById('rule-actions')?.scrollIntoView({ behavior: 'smooth' })}>{t('rules.editor.nav.actions')} <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-medium">{props.rule.actions.length}</span></Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 system-xs-medium" onClick={() => document.getElementById('rule-tests')?.scrollIntoView({ behavior: 'smooth' })}><FlaskConical />{t('rules.editor.nav.tests')} <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-medium">{props.rule.testCases.length}</span></Button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background">
          <RuleEditor rule={props.rule} onChange={props.onChange} />
          <section id="rule-tests" className="mx-4 mb-4 grid scroll-mt-4 gap-3 rounded-lg border border-module-border bg-card p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="system-sm-medium text-text-primary">{t('rules.tests.title')}</h3>
                <p className="mt-0.5 system-xs-regular text-text-tertiary">{t('rules.tests.description')}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" className="h-8 shrink-0 px-2.5 system-xs-medium" onClick={addTestCase}><Plus /> {t('rules.tests.add')}</Button>
            </div>
            <div className="grid gap-2.5">
              {props.rule.testCases.length > 0 ? (
                <div className="grid gap-2.5">
                  {props.rule.testCases.map((testCase, index) => {
                      const result = testResults[testCase.id]
                      const isTesting = testingId === testCase.id
                      return (
                        <article key={testCase.id} className="grid gap-3 rounded-lg border border-module-border p-3">
                          <div className="flex items-center gap-2 pb-1">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-inset system-2xs-medium text-text-tertiary">{index + 1}</span>
                            <Input aria-label={t('rules.tests.nameAria', { index: index + 1 })} className="min-w-0 flex-1" value={testCase.name} onChange={event => updateTestCase(testCase.id, { name: event.target.value })} />
                            <Button type="button" size="sm" className="h-8 shrink-0 system-xs-medium" onClick={() => runTest(testCase)} disabled={isTesting}>{isTesting && <LoaderCircle className="animate-spin" />}{t('rules.tests.run')}</Button>
                            <Button type="button" variant="ghost" size="icon-sm" className="text-text-tertiary hover:text-text-destructive" aria-label={t('rules.tests.deleteAria', { index: index + 1 })} onClick={() => setDeleteTestCaseId(testCase.id)}><Trash2 /></Button>
                          </div>
                          <FormField label={t('rules.tests.stage')} htmlFor={`${testCase.id}-stage`}>
                            <Select value={testCase.stage} onValueChange={value => { const stage = value as RuleTestCase['stage']; const input = defaultTestInput(stage); updateTestCase(testCase.id, { stage, ...input }) }}>
                              <SelectTrigger id={`${testCase.id}-stage`} className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="request">{t('rules.stage.request')}</SelectItem><SelectItem value="response">{t('rules.stage.response')}</SelectItem></SelectContent>
                            </Select>
                          </FormField>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <FormField label={t(testCase.stage === 'response' ? 'rules.tests.bodyLabel.response' : 'rules.tests.bodyLabel.request')} htmlFor={`${testCase.id}-body`}>
                              <Textarea id={`${testCase.id}-body`} value={testCase.body} onChange={event => updateTestCase(testCase.id, { body: event.target.value })} className="min-h-32 font-mono" />
                            </FormField>
                            <FormField label={t(testCase.stage === 'response' ? 'rules.tests.headersLabel.response' : 'rules.tests.headersLabel.request')} htmlFor={`${testCase.id}-headers`}>
                              <Textarea id={`${testCase.id}-headers`} value={testCase.headers} onChange={event => updateTestCase(testCase.id, { headers: event.target.value })} className="min-h-32 font-mono" />
                            </FormField>
                          </div>
                          {result && (
                            <div className="grid gap-2 rounded-lg border border-module-border bg-inset p-2.5 system-2xs-regular">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-tertiary">
                                <span>{t('rules.tests.applied', { value: result.appliedRuleIds.length ? t('rules.tests.currentRule') : t('rules.tests.none') })}</span>
                                <span>{t('rules.tests.skipped', { value: result.skippedRuleIds.length ? t('rules.tests.currentRule') : t('rules.tests.none') })}</span>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2"><pre className="max-h-36 overflow-auto rounded-md bg-card p-2 font-mono">{JSON.stringify(result.headers, null, 2)}</pre><pre className="max-h-36 overflow-auto rounded-md bg-card p-2 font-mono">{result.body}</pre></div>
                            </div>
                          )}
                        </article>
                      )
                    })}
                </div>
              ) : <div className="rounded-lg border border-dashed border-module-border px-4 py-8 text-center"><p className="system-xs-medium text-text-primary">{t('rules.tests.empty.title')}</p><p className="mt-1 system-xs-regular text-text-tertiary">{t('rules.tests.empty.description')}</p></div>}
            </div>
          </section>
        </div>

        <ConfirmDialog
          open={Boolean(deleteTestCaseId)}
          title={t('rules.tests.delete.title')}
          description={t('rules.tests.delete.description')}
          confirmLabel={t('rules.tests.delete.confirm')}
          variant="destructive"
          onConfirm={() => {
            if (deleteTestCaseId) removeTestCase(deleteTestCaseId)
            setDeleteTestCaseId(undefined)
          }}
          onOpenChange={open => !open && setDeleteTestCaseId(undefined)}
        />

        <SheetFooter className="mt-auto flex shrink-0 flex-row items-center justify-end gap-2 border-t border-border/50 bg-card px-4 py-3">
          {props.dirty
            ? <span className="mr-auto hidden system-xs-medium text-text-warning sm:inline">{t('rules.editor.dirty')}</span>
            : <span className="mr-auto hidden system-xs-regular text-text-tertiary sm:inline">{t('rules.editor.clean')}</span>}
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="sm" className="max-sm:mr-auto">{t('rules.editor.cancel')}</Button>
          </SheetClose>
          <Button type="button" size="sm" onClick={props.onSave} disabled={!props.dirty || !props.rule.name.trim() || props.rule.actions.length === 0}>
            <Save /> {t('rules.editor.save')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
