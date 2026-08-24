import { useState } from 'react'
import { Beaker, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react'
import { modificationRuleApi } from '@/api/models'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { RuleEditor } from './rule-editor'
import type { ModificationRule, RuleTestCase } from '../types'
import type { ModificationRule as ApiModificationRule } from '@common/schemas'

interface RuleTestResult {
  body: string
  headers: Record<string, string | string[] | undefined>
  appliedRuleIds: string[]
  skippedRuleIds: string[]
}

interface RuleEditorDialogProps {
  open: boolean
  rule: ModificationRule
  dirty: boolean
  onOpenChange: (open: boolean) => void
  onChange: (rule: ModificationRule) => void
  onSave: () => void
  onReset: () => void
}

export function RuleEditorDialog(props: RuleEditorDialogProps) {
  const toast = useToast()
  const [testOpen, setTestOpen] = useState(false)
  const [selectedTestId, setSelectedTestId] = useState(props.rule.testCases[0]?.id ?? '')
  const selectedTest = props.rule.testCases.find(testCase => testCase.id === selectedTestId) ?? props.rule.testCases[0]
  const [testResult, setTestResult] = useState<RuleTestResult>()
  const [testing, setTesting] = useState(false)

  const updateTestCases = (testCases: RuleTestCase[]) => props.onChange({ ...props.rule, testCases })
  const addTestCase = () => {
    const id = `test-${Date.now()}`
    const testCase: RuleTestCase = { id, name: `测试用例 ${props.rule.testCases.length + 1}`, stage: 'request', body: '{\n  "model": "demo",\n  "messages": [{ "role": "user", "content": "hello" }]\n}', headers: '{\n  "content-type": "application/json"\n}', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', logicalModelId: 'default', providerModelId: 'test-model', path: '/v1/chat/completions', streaming: false }
    updateTestCases([...props.rule.testCases, testCase])
    setSelectedTestId(id)
  }
  const updateSelectedTest = (patch: Partial<RuleTestCase>) => {
    if (!selectedTest) return
    updateTestCases(props.rule.testCases.map(testCase => testCase.id === selectedTest.id ? { ...testCase, ...patch } : testCase))
  }
  const removeSelectedTest = () => {
    if (!selectedTest) return
    const next = props.rule.testCases.filter(testCase => testCase.id !== selectedTest.id)
    updateTestCases(next)
    setSelectedTestId(next[0]?.id ?? '')
    setTestResult(undefined)
  }

  const runTest = () => {
    if (!selectedTest) return
    setTesting(true)
    const rule: ApiModificationRule = {
      id: props.rule.id,
      name: props.rule.name,
      description: props.rule.description,
      enabled: props.rule.enabled,
      scope: props.rule.global ? 'global' : 'model',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: props.rule.match.clientProtocols as ApiModificationRule['match']['clientProtocols'], upstreamProtocols: props.rule.match.upstreamProtocols as ApiModificationRule['match']['upstreamProtocols'], path: props.rule.match.path, logicalModelId: props.rule.match.logicalModelId, providerModelId: props.rule.match.providerModelId },
      testCases: [],
      actions: props.rule.actions.map(action => action.target === 'header'
        ? action.operation === 'remove' ? { type: 'header-remove', stage: action.stage, name: action.path } : { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
        : action.operation === 'remove' ? { type: 'body-delete', stage: action.stage, path: action.path } : action.operation === 'replace' ? { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false } : { type: 'body-set', stage: action.stage, path: action.path, value: action.value ?? '' }),
      createdTime: 0,
      updatedTime: 0,
      deletedTime: null,
    }
    void modificationRuleApi.test(rule, selectedTest).then(response => {
      if (!response.success) toast.error(response.errorMessage)
      else setTestResult(response.data)
      setTesting(false)
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
        className="w-140! max-w-140! gap-0 border-0 bg-card p-0 text-card-foreground shadow-none"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <SheetHeader className="shrink-0 bg-card px-6 py-5 pr-14">
          <SheetTitle className="text-base">{props.rule.updatedAt === '尚未保存' ? '新建请求修改' : '编辑请求修改'}</SheetTitle>
          <SheetDescription className="text-xs">定义请求或响应中的字段转换。</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/60">
          <RuleEditor rule={props.rule} onChange={props.onChange} />
          <section className="mx-5 mb-5 rounded-lg border bg-card">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left" onClick={() => setTestOpen(open => !open)}>
              <span className="flex items-center gap-2 text-xs font-semibold"><Beaker className="size-3.5 text-info" />测试当前规则</span>
              <span className="text-[11px] text-muted-foreground">{testOpen ? '收起' : '展开'}</span>
            </button>
            {testOpen && (
              <div className="space-y-3 border-t p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">测试用例会随请求修改规则保存，测试使用当前未保存草稿。</p>
                  <Button type="button" variant="outline" size="sm" onClick={addTestCase}><Plus /> 新增用例</Button>
                </div>
                {props.rule.testCases.length > 0 && selectedTest ? (
                  <>
                    <div className="flex items-center gap-2">
                      <select aria-label="选择测试用例" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" value={selectedTest.id} onChange={event => { setSelectedTestId(event.target.value); setTestResult(undefined) }}>
                        {props.rule.testCases.map(testCase => <option key={testCase.id} value={testCase.id}>{testCase.name}</option>)}
                      </select>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={removeSelectedTest} aria-label="删除测试用例"><Trash2 /></Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label htmlFor="inline-rule-test-name" className="text-[11px]">用例名称</Label><input id="inline-rule-test-name" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={selectedTest.name} onChange={event => updateSelectedTest({ name: event.target.value })} /></div>
                      <div className="space-y-1.5"><Label htmlFor="inline-rule-test-path" className="text-[11px]">请求路径</Label><input id="inline-rule-test-path" className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs" value={selectedTest.path} onChange={event => updateSelectedTest({ path: event.target.value })} /></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label htmlFor="inline-rule-test-body" className="text-[11px]">请求 Body（JSON）</Label><Textarea id="inline-rule-test-body" value={selectedTest.body} onChange={event => updateSelectedTest({ body: event.target.value })} className="min-h-32 font-mono text-xs" /></div>
                      <div className="space-y-1.5"><Label htmlFor="inline-rule-test-headers" className="text-[11px]">请求 Headers（JSON）</Label><Textarea id="inline-rule-test-headers" value={selectedTest.headers} onChange={event => updateSelectedTest({ headers: event.target.value })} className="min-h-32 font-mono text-xs" /></div>
                    </div>
                    <Button type="button" size="sm" onClick={runTest} disabled={testing}>
                      {testing && <LoaderCircle className="animate-spin" />}运行测试
                    </Button>
                  </>
                ) : <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-[11px] text-muted-foreground">还没有测试用例，点击“新增用例”开始。</p>}
                {testResult && (
                  <div className="space-y-2 rounded-md bg-muted/45 p-2.5 text-[11px]">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>已应用：{testResult.appliedRuleIds.length ? '当前规则' : '无'}</span>
                      <span>已跳过：{testResult.skippedRuleIds.length ? '当前规则' : '无'}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <pre className="max-h-36 overflow-auto rounded bg-background p-2 font-mono">{JSON.stringify(testResult.headers, null, 2)}</pre>
                      <pre className="max-h-36 overflow-auto rounded bg-background p-2 font-mono">{testResult.body}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 bg-card px-6 py-4">
          {props.dirty && <span className="mr-auto text-xs text-warning">未保存</span>}
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="sm">取消</Button>
          </SheetClose>
          <Button type="button" size="sm" onClick={props.onSave} disabled={!props.dirty}>
            <Save /> 保存
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
