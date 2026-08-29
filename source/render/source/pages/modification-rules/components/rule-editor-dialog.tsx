import { useState } from 'react'
import { FlaskConical, ListFilter, LoaderCircle, PencilLine, Plus, Save, Trash2 } from 'lucide-react'
import { requestRewriteRuleApi } from '@/api/models'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
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
    const testCase: RuleTestCase = { id, name: `测试用例 ${props.rule.testCases.length + 1}`, stage: 'request', ...input, clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', streaming: false }
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
      source: 'user',
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
          <SheetTitle className="text-sm">{props.rule.updatedAt === '尚未保存' ? '新建请求修改规则' : '编辑请求修改规则'}</SheetTitle>
          <SheetDescription className="text-xs">配置匹配条件、修改动作，并用样例验证结果</SheetDescription>
        </SheetHeader>

        <nav aria-label="表单分区" className="flex shrink-0 items-center gap-1 overflow-x-auto border-y border-border bg-muted/30 px-4 py-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => document.getElementById('rule-overview')?.scrollIntoView({ behavior: 'smooth' })}><PencilLine />概览</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => document.getElementById('rule-match')?.scrollIntoView({ behavior: 'smooth' })}><ListFilter />匹配</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => document.getElementById('rule-actions')?.scrollIntoView({ behavior: 'smooth' })}>动作 <span className="rounded bg-background px-1.5 py-0.5 text-[10px] dark:bg-muted">{props.rule.actions.length}</span></Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => document.getElementById('rule-tests')?.scrollIntoView({ behavior: 'smooth' })}><FlaskConical />测试 <span className="rounded bg-background px-1.5 py-0.5 text-[10px] dark:bg-muted">{props.rule.testCases.length}</span></Button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
          <RuleEditor rule={props.rule} onChange={props.onChange} />
          <section id="rule-tests" className="mx-4 mb-4 scroll-mt-4 space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">测试</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">使用当前草稿验证动作是否按预期生效。</p>
              </div>
              <Button type="button" variant="secondary" size="sm" className="h-8 shrink-0 px-2.5 text-[11px]" onClick={addTestCase}><Plus /> 添加测试</Button>
            </div>
            <div className="space-y-2.5">
              {props.rule.testCases.length > 0 ? (
                <div className="space-y-2.5">
                  {props.rule.testCases.map((testCase, index) => {
                      const result = testResults[testCase.id]
                      const isTesting = testingId === testCase.id
                      return (
                        <article key={testCase.id} className="space-y-3 rounded-md border border-border bg-muted/40 p-3 dark:bg-inset">
                          <div className="flex items-center gap-2 pb-3">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                            <input aria-label={`测试用例 ${index + 1} 名称`} className="h-7 min-w-0 flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground" value={testCase.name} onChange={event => updateTestCase(testCase.id, { name: event.target.value })} />
                            <Button type="button" size="sm" className="h-7 text-[11px]" onClick={() => runTest(testCase)} disabled={isTesting}>{isTesting && <LoaderCircle className="animate-spin" />}运行测试</Button>
                            <Popover open={deleteTestCaseId === testCase.id} onOpenChange={open => setDeleteTestCaseId(open ? testCase.id : undefined)}>
                              <PopoverTrigger asChild>
                                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`删除测试用例 ${index + 1}`}><Trash2 /></Button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-56">
                                <p className="text-xs font-medium">删除这个测试用例？</p>
                                <p className="text-[11px] text-muted-foreground">删除后需要保存规则才会生效。</p>
                                <div className="flex justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setDeleteTestCaseId(undefined)}>取消</Button>
                                  <Button type="button" variant="destructive" size="sm" className="h-7 text-[11px]" onClick={() => { removeTestCase(testCase.id); setDeleteTestCaseId(undefined) }}>删除</Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${testCase.id}-stage`} className="text-[11px]">测试阶段</Label>
                            <select id={`${testCase.id}-stage`} className="h-7 w-full rounded-md border-0 bg-background px-2 text-xs ring-1 ring-foreground/10" value={testCase.stage} onChange={event => { const stage = event.target.value as RuleTestCase['stage']; const input = defaultTestInput(stage); updateTestCase(testCase.id, { stage, ...input }) }}><option value="request">请求</option><option value="response">响应</option></select>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5"><Label htmlFor={`${testCase.id}-body`} className="text-[11px]">{testCase.stage === 'response' ? '响应 Body' : '请求 Body'}（JSON）</Label><Textarea id={`${testCase.id}-body`} value={testCase.body} onChange={event => updateTestCase(testCase.id, { body: event.target.value })} className="min-h-32 font-mono text-xs" /></div>
                            <div className="space-y-1.5"><Label htmlFor={`${testCase.id}-headers`} className="text-[11px]">{testCase.stage === 'response' ? '响应 Headers' : '请求 Headers'}（JSON）</Label><Textarea id={`${testCase.id}-headers`} value={testCase.headers} onChange={event => updateTestCase(testCase.id, { headers: event.target.value })} className="min-h-32 font-mono text-xs" /></div>
                          </div>
                          {result && (
                            <div className="space-y-2 rounded-md bg-muted/45 p-2.5 text-[11px]">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"><span>已应用：{result.appliedRuleIds.length ? '当前规则' : '无'}</span><span>已跳过：{result.skippedRuleIds.length ? '当前规则' : '无'}</span></div>
                              <div className="grid gap-2 sm:grid-cols-2"><pre className="max-h-36 overflow-auto rounded bg-background p-2 font-mono">{JSON.stringify(result.headers, null, 2)}</pre><pre className="max-h-36 overflow-auto rounded bg-background p-2 font-mono">{result.body}</pre></div>
                            </div>
                          )}
                        </article>
                      )
                    })}
                </div>
              ) : <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center dark:bg-inset"><p className="text-xs font-medium">还没有测试用例</p><p className="mt-1 text-[11px] text-muted-foreground">测试不会保存请求记录，可在保存前反复运行。</p></div>}
            </div>
          </section>
        </div>

        <SheetFooter className="mt-auto flex shrink-0 flex-row items-center justify-end gap-2 border-t border-border bg-muted/50 px-4 py-3">
          {props.dirty ? <span className="mr-auto hidden text-xs text-warning sm:inline">有尚未保存的更改</span> : <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">没有待保存的更改</span>}
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="sm" className="max-sm:mr-auto">取消</Button>
          </SheetClose>
          <Button type="button" size="sm" onClick={props.onSave} disabled={!props.dirty || !props.rule.name.trim() || props.rule.actions.length === 0}>
            <Save /> 保存规则
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
