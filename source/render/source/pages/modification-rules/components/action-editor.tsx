import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  readOnly?: boolean
}

export function ActionEditor(props: ActionEditorProps) {
  const updateAction = (id: string, patch: Partial<RuleAction>) => {
    props.onChange(props.actions.map(action => action.id === id ? { ...action, ...patch } : action))
  }

  const addAction = () => {
    props.onChange([...props.actions, { id: `action-${Date.now()}`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }])
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold">动作</h3>
          <p className="text-[11px] text-muted-foreground">按顺序执行</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={addAction} disabled={props.readOnly}>
          <Plus /> 添加动作
        </Button>
      </div>

      <div className="space-y-2">
        {props.actions.map((action, index) => {
          const isHeader = action.target === 'header'
          const isRemove = action.operation === 'remove'
          const isReplace = action.operation === 'replace'
          const operations = isHeader ? (['set', 'append', 'remove'] as RuleActionOperation[]) : (['set', 'remove', 'replace'] as RuleActionOperation[])

          return (
            <div key={action.id} className="rounded-lg bg-muted/45 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-medium text-muted-foreground">{index + 1}</span>
                <Select value={action.stage} onValueChange={value => updateAction(action.id, { stage: value as 'request' | 'response' })} disabled={props.readOnly}>
                  <SelectTrigger className="h-7 w-20 bg-background px-2.5 text-[11px]" aria-label={`动作 ${index + 1} 阶段`}><SelectValue /></SelectTrigger>
                  <SelectContent className="min-w-24 text-xs"><SelectItem className="text-xs" value="request">请求</SelectItem><SelectItem className="text-xs" value="response">响应</SelectItem></SelectContent>
                </Select>
                <Select value={action.target} onValueChange={value => updateAction(action.id, { target: value as RuleActionTarget, operation: 'set', value: '' })} disabled={props.readOnly}>
                  <SelectTrigger className="h-7 w-24 bg-background px-2 text-xs" aria-label={`动作 ${index + 1} 目标`}><SelectValue /></SelectTrigger>
                  <SelectContent className="min-w-24 text-xs"><SelectItem className="text-xs" value="header">Header</SelectItem><SelectItem className="text-xs" value="body">Body</SelectItem></SelectContent>
                </Select>
                <Select value={action.operation} onValueChange={value => updateAction(action.id, { operation: value as RuleActionOperation })} disabled={props.readOnly}>
                  <SelectTrigger className="h-7 w-20 bg-background px-2 text-xs" aria-label={`动作 ${index + 1} 操作`}><SelectValue /></SelectTrigger>
                  <SelectContent className="min-w-20 text-xs">{operations.map(operation => <SelectItem className="text-xs" key={operation} value={operation}>{operationLabels[operation]}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => props.onChange(props.actions.filter(item => item.id !== action.id))}
                    aria-label="删除动作"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={props.readOnly}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div className="mt-2.5 grid gap-2.5 pl-7 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`${action.id}-target`} className="text-[11px]">
                    {isHeader ? 'Header 名称' : 'Body 路径'}
                  </Label>
                  <Input
                    id={`${action.id}-target`}
                    value={action.path}
                    onChange={event => updateAction(action.id, { path: event.target.value })}
                    placeholder={isHeader ? '例如 User-Agent' : '例如 $.metadata.source（当前支持 JSON Body）'}
                    className="h-8 bg-background font-mono text-xs placeholder:font-mono"
                    disabled={props.readOnly}
                  />
                </div>
                {!isRemove && (
                  <div className="space-y-1">
                    <Label htmlFor={`${action.id}-value`} className="text-[11px]">
                      {isReplace ? '查找内容' : '值'}
                    </Label>
                    <Input
                      id={`${action.id}-value`}
                      value={action.value ?? ''}
                      onChange={event => updateAction(action.id, { value: event.target.value })}
                      placeholder={isReplace ? '输入查找内容' : '输入值'}
                      className="h-8 bg-background text-xs"
                      disabled={props.readOnly}
                    />
                  </div>
                )}
                {isReplace && (
                  <div className="space-y-1">
                    <Label htmlFor={`${action.id}-replacement`} className="text-[11px]">替换为</Label>
                    <Input
                      id={`${action.id}-replacement`}
                      value={action.replacement ?? ''}
                      onChange={event => updateAction(action.id, { replacement: event.target.value })}
                      placeholder="输入替换结果，可用 $1 引用捕获组"
                      className="h-8 bg-background text-xs"
                      disabled={props.readOnly}
                    />
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Switch checked={action.regex ?? false} onCheckedChange={regex => updateAction(action.id, { regex })} aria-label="使用正则表达式" disabled={props.readOnly} />
                      使用正则表达式
                    </label>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
