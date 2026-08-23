import { Braces, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RuleAction, RuleActionType } from '../types'

const actionLabels: Record<RuleActionType, string> = {
  'header-set': '设置 Header',
  'header-append': '追加 Header',
  'header-remove': '删除 Header',
  'json-set': '设置 JSON 值',
  'json-delete': '删除 JSON 路径',
  'json-replace': '替换字符串',
}

interface ActionEditorProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

export function ActionEditor(props: ActionEditorProps) {
  const updateAction = (id: string, patch: Partial<RuleAction>) => {
    props.onChange(props.actions.map(action => action.id === id ? { ...action, ...patch } : action))
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= props.actions.length) return
    const next = [...props.actions]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    props.onChange(next)
  }

  const addAction = () => {
    props.onChange([
      ...props.actions,
      { id: `action-${Date.now()}`, type: 'header-set', target: '', value: '' },
    ])
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold">修改动作</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">动作按从上到下的顺序执行，每个动作只处理一个明确字段。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addAction}>
          <Plus /> 添加动作
        </Button>
      </div>

      <div className="space-y-2">
        {props.actions.map((action, index) => {
          const isRemove = action.type === 'header-remove' || action.type === 'json-delete'
          const isReplace = action.type === 'json-replace'
          const isHeader = action.type.startsWith('header')

          return (
            <div key={action.id} className="rounded-lg bg-muted/35 p-3">
              <div className="flex items-center gap-2">
                <GripVertical className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                  <Braces className="size-3.5" />
                </span>
                <Select
                  value={action.type}
                  onValueChange={value => updateAction(action.id, { type: value as RuleActionType })}
                >
                  <SelectTrigger className="h-8 min-w-40 flex-1 bg-background text-xs" aria-label={`动作 ${index + 1} 类型`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(actionLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => moveAction(index, -1)}
                    disabled={index === 0}
                    aria-label="上移动作"
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => moveAction(index, 1)}
                    disabled={index === props.actions.length - 1}
                    aria-label="下移动作"
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => props.onChange(props.actions.filter(item => item.id !== action.id))}
                    aria-label="删除动作"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 pl-8 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${action.id}-target`} className="text-[11px]">
                    {isHeader ? 'Header 名称' : 'JSON 路径'}
                  </Label>
                  <Input
                    id={`${action.id}-target`}
                    value={action.target}
                    onChange={event => updateAction(action.id, { target: event.target.value })}
                    placeholder={isHeader ? '例如 User-Agent' : '例如 $.metadata.source'}
                    className="h-8 bg-background font-mono text-xs"
                  />
                </div>
                {!isRemove && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${action.id}-value`} className="text-[11px]">
                      {isReplace ? '查找内容' : '值'}
                    </Label>
                    <Input
                      id={`${action.id}-value`}
                      value={action.value ?? ''}
                      onChange={event => updateAction(action.id, { value: event.target.value })}
                      placeholder={isReplace ? '需要精确匹配的字符串' : '输入字符串、数字、布尔值或 JSON'}
                      className="h-8 bg-background font-mono text-xs"
                    />
                  </div>
                )}
                {isReplace && (
                  <div className="space-y-1.5 md:col-start-2">
                    <Label htmlFor={`${action.id}-replacement`} className="text-[11px]">替换为</Label>
                    <Input
                      id={`${action.id}-replacement`}
                      value={action.replacement ?? ''}
                      onChange={event => updateAction(action.id, { replacement: event.target.value })}
                      placeholder="替换后的字符串"
                      className="h-8 bg-background font-mono text-xs"
                    />
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
