import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { protocolOptions, type RequestRewriteRule } from '../types'

interface RuleEditorProps {
  rule: RequestRewriteRule
  onChange: (rule: RequestRewriteRule) => void
}

interface ProtocolPickerProps {
  label: string
  description: string
  selected: string[]
  onToggle: (protocol: string) => void
}

function ProtocolPicker(props: ProtocolPickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-xs">{props.label}</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{props.description}</p>
        </div>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {props.selected.length ? `${props.selected.length} 个` : '全部'}
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {protocolOptions.map(protocol => {
          const selected = props.selected.includes(protocol)
          return (
            <button
              key={protocol}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onToggle(protocol)}
              className={cn(
                'flex min-h-10 items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-inset dark:hover:bg-muted',
                selected && 'bg-primary/12 text-foreground dark:bg-primary/12',
              )}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center rounded bg-muted', selected && 'bg-primary text-primary-foreground')}>
                {selected && <Check className="size-3" />}
              </span>
              <span className="leading-4">{protocol}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RuleEditor(props: RuleEditorProps) {
  const { rule } = props
  const update = (patch: Partial<RequestRewriteRule>) => props.onChange({ ...rule, ...patch })
  const updateMatch = (patch: Partial<RequestRewriteRule['match']>) => update({ match: { ...rule.match, ...patch } })

  const toggleClientProtocol = (protocol: string) => {
    const protocols = rule.protocols.includes(protocol)
      ? rule.protocols.filter(item => item !== protocol)
      : [...rule.protocols, protocol]
    update({ protocols })
  }

  const toggleUpstreamProtocol = (protocol: string) => {
    const valueByLabel = Object.fromEntries(protocolOptions.map((label, index) => [label, ['openai-completions', 'openai-responses', 'anthropic-messages'][index]]))
    const value = valueByLabel[protocol]
    const upstreamProtocols = rule.match.upstreamProtocols.includes(value)
      ? rule.match.upstreamProtocols.filter(item => item !== value)
      : [...rule.match.upstreamProtocols, value]
    updateMatch({ upstreamProtocols })
  }

  const upstreamLabels = rule.match.upstreamProtocols.map(value => ({
    'openai-completions': 'OpenAI Completions',
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages',
  })[value] ?? value)

  return (
    <div className="space-y-4 px-4 py-4">
      <section id="rule-overview" className="scroll-mt-16 space-y-4 rounded-lg border border-border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">概览</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">命名规则并决定它如何生效。</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name" className="text-[11px]">规则名称</Label>
            <Input id="rule-name" className="h-9 bg-muted/40 text-xs dark:bg-inset" value={rule.name} onChange={event => update({ name: event.target.value })} placeholder="例如：移除不兼容参数" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-description" className="text-[11px]">说明 <span className="font-normal text-muted-foreground">（可选）</span></Label>
            <Textarea id="rule-description" className="min-h-20 resize-none bg-muted/40 text-xs dark:bg-inset" value={rule.description} onChange={event => update({ description: event.target.value })} placeholder="说明这条规则解决什么兼容问题" />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-16 items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2.5 dark:bg-inset">
            <span>
              <span className="block text-xs font-medium">启用规则</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">停用后不参与任何请求</span>
            </span>
            <Switch checked={rule.enabled} onCheckedChange={enabled => update({ enabled })} />
          </label>
          <label className="flex min-h-16 items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2.5 dark:bg-inset">
            <span>
              <span className="block text-xs font-medium">全局应用</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">无需绑定模型即可生效</span>
            </span>
            <Switch checked={rule.global} onCheckedChange={global => update({ global })} />
          </label>
        </div>
      </section>

      <section id="rule-match" className="scroll-mt-16 space-y-4 rounded-lg border border-border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">匹配条件</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">所有已填写条件同时满足时执行；留空表示不限制。</p>
        </div>
        <ProtocolPicker label="客户端协议" description="进入代理时识别到的协议" selected={rule.protocols} onToggle={toggleClientProtocol} />
        <ProtocolPicker label="上游协议" description="协议转换后发往供应商的协议" selected={upstreamLabels} onToggle={toggleUpstreamProtocol} />
      </section>

      <div id="rule-actions" className="scroll-mt-16 rounded-lg border border-border bg-card p-4">
        <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} />
      </div>
    </div>
  )
}
