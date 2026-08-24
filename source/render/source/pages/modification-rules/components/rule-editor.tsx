import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { protocolOptions, type ModificationRule } from '../types'

interface RuleEditorProps {
  rule: ModificationRule
  onChange: (rule: ModificationRule) => void
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
    <div className="space-y-6 px-6 py-5">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">基本信息</h3>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name" className="text-[11px]">规则名称</Label>
            <Input id="rule-name" className="h-8 bg-background text-xs" value={rule.name} onChange={event => update({ name: event.target.value })} placeholder="例如：移除不兼容参数" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-description" className="text-[11px]">说明 <span className="font-normal text-muted-foreground">（可选）</span></Label>
            <Input id="rule-description" className="h-8 bg-background text-xs" value={rule.description} onChange={event => update({ description: event.target.value })} placeholder="说明这条规则解决什么兼容问题" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">适用协议</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">不选择时，这条规则适用于全部协议。</p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{rule.protocols.length ? `${rule.protocols.length} 个已选` : '全部'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {protocolOptions.map(protocol => {
            const selected = rule.protocols.includes(protocol)
            return (
              <button
                key={protocol}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleProtocol(protocol)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-[11px] font-medium transition-colors hover:bg-muted hover:text-foreground',
                  selected && 'border-primary/60 bg-primary/8 text-foreground',
                )}
              >
                <span aria-hidden="true" className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/55 bg-background', selected && 'border-primary bg-primary')}>
                  {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                </span>
                {protocol}
              </button>
            )
          })}
        </div>
      </section>

      <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} />
    </div>
  )
}
