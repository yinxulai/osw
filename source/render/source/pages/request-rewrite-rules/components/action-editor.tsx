import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { RuleAction, RuleActionOperation, RuleActionTarget } from '../types'

const operationLabels: Record<RuleActionOperation, string> = {
  set: '设置', append: '追加', remove: '删除', replace: '替换',
}

interface ActionEditorProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

export function ActionEditor(props: ActionEditorProps) {
  const [deleteActionId, setDeleteActionId] = useState<string>()

  const updateAction = (id: string, patch: Partial<RuleAction>) => {
    props.onChange(props.actions.map(action => action.id === id ? { ...action, ...patch } : action))
  }

  const addAction = () => {
    props.onChange([...props.actions, { id: `action-${Date.now()}`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }])
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">动作</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">按列表顺序依次修改请求或响应内容。</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-[11px]" onClick={addAction}>
          <Plus /> 添加动作
        </Button>
      </div>

      <div className="space-y-2.5">
        {props.actions.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center dark:bg-inset">
            <p className="text-xs font-medium">还没有动作</p>
            <p className="mt-1 text-[11px] text-muted-foreground">添加至少一个动作来修改 Header 或 JSON Body。</p>
          </div>
        )}
        {props.actions.map((action, index) => {
          const isHeader = action.target === 'header'
          const isRemove = action.operation === 'remove'
          const isReplace = action.operation === 'replace'
          const operations = isHeader ? (['set', 'append', 'remove'] as RuleActionOperation[]) : (['set', 'remove', 'replace'] as RuleActionOperation[])

          return (
            <div key={action.id} className="rounded-md border border-border bg-muted/40 p-3 dark:bg-inset">
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                <span className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                <Select value={action.stage} onValueChange={value => updateAction(action.id, { stage: value as 'request' | 'response' })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 阶段`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="request">请求</SelectItem><SelectItem value="response">响应</SelectItem></SelectContent>
                </Select>
                <Select value={action.target} onValueChange={value => updateAction(action.id, { target: value as RuleActionTarget, operation: 'set', value: '' })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 目标`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="header">Header</SelectItem><SelectItem value="body">Body</SelectItem></SelectContent>
                </Select>
                <Select value={action.operation} onValueChange={value => updateAction(action.id, { operation: value as RuleActionOperation })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 操作`}><SelectValue /></SelectTrigger>
                  <SelectContent>{operations.map(operation => <SelectItem key={operation} value={operation}>{operationLabels[operation]}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="删除动作" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setDeleteActionId(action.id)}>
                  <Trash2 />
                </Button>
              </div>

              <div className="mt-3 grid gap-3 pl-0 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`${action.id}-target`} className="text-[11px]">
                    {isHeader ? 'Header 名称' : 'Body 路径'}
                  </Label>
                  <Input
                    id={`${action.id}-target`}
                    value={action.path}
                    onChange={event => updateAction(action.id, { path: event.target.value })}
                    placeholder={isHeader ? '例如 User-Agent' : '例如 $.metadata.source（当前支持 JSON Body）'}
                    className="h-7 bg-background px-2 font-mono placeholder:font-mono"
                  />
                </div>
                {!isRemove && (
                  <div className={isReplace ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
                    <Label htmlFor={`${action.id}-value`} className="text-[11px]">
                      {isReplace ? '查找内容' : isHeader ? '值' : 'JSON 值'}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`${action.id}-value`}
                        value={action.value ?? ''}
                        onChange={event => updateAction(action.id, { value: event.target.value })}
                        placeholder={isReplace ? '输入查找内容，例如 foo(\\d+)' : isHeader ? '输入 Header 值' : '例如 "text"、true、42 或 {"key":"value"}'}
                        className="h-7 min-w-0 flex-1 bg-background px-2 font-mono"
                      />
                      {isReplace && (
                        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Switch checked={action.regex ?? false} onCheckedChange={regex => updateAction(action.id, { regex })} aria-label="使用正则表达式" />
                          正则
                        </label>
                      )}
                    </div>
                  </div>
                )}
                {isReplace && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${action.id}-replacement`} className="text-[11px]">替换为</Label>
                    <Input
                      id={`${action.id}-replacement`}
                      value={action.replacement ?? ''}
                      onChange={event => updateAction(action.id, { replacement: event.target.value })}
                      placeholder="输入替换结果，可用 $1 引用捕获组"
                      className="h-7 bg-background px-2"
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={Boolean(deleteActionId)}
        title="删除这个动作？"
        description="该动作将从当前草稿中移除，保存规则后生效。"
        confirmLabel="删除动作"
        variant="destructive"
        onConfirm={() => {
          props.onChange(props.actions.filter(action => action.id !== deleteActionId))
          setDeleteActionId(undefined)
        }}
        onOpenChange={open => !open && setDeleteActionId(undefined)}
      />
    </section>
  )
}
