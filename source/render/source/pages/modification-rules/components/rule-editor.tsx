import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { protocolOptions, type ModificationRule } from '../types'

interface RuleEditorProps {
  rule: ModificationRule
  onChange: (rule: ModificationRule) => void
  readOnly?: boolean
}

export function RuleEditor(props: RuleEditorProps) {
  const { rule } = props
  const update = (patch: Partial<ModificationRule>) => props.onChange({ ...rule, ...patch })

  const toggleProtocol = (protocol: string) => {
    const protocols = rule.protocols.includes(protocol)
      ? rule.protocols.filter(item => item !== protocol)
      : [...rule.protocols, protocol]
    update({ protocols })
  }

  return (
    <div className="space-y-5 px-5 py-4">
      <section className="space-y-2.5">
        <div className="space-y-1">
          <Label htmlFor="rule-name" className="text-[11px]">规则名称</Label>
          <Input id="rule-name" className="h-8 text-xs" value={rule.name} onChange={event => update({ name: event.target.value })} placeholder="例如：移除不兼容参数" disabled={props.readOnly} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          请求和响应阶段可在每个动作中分别设置
        </p>
        <div className="space-y-1">
          <Label htmlFor="rule-description" className="text-[11px]">说明 <span className="font-normal text-muted-foreground">（可选）</span></Label>
          <Input id="rule-description" className="h-8 text-xs" value={rule.description} onChange={event => update({ description: event.target.value })} placeholder="说明这条规则解决什么兼容问题" disabled={props.readOnly} />
        </div>
      </section>

      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold">适用协议</h3>
          <p className="text-[11px] text-muted-foreground">不选择 = 全部协议</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {protocolOptions.map(protocol => {
            const selected = rule.protocols.includes(protocol)
            return (
              <button
                key={protocol}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleProtocol(protocol)}
                disabled={props.readOnly}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted hover:text-foreground',
                  selected && 'border-primary/60 bg-primary/8 text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/55 bg-background',
                    selected && 'border-primary bg-primary',
                  )}
                >
                  {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                </span>
                {protocol}
              </button>
            )
          })}
        </div>
      </section>

      <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} readOnly={props.readOnly} />
    </div>
  )
}
