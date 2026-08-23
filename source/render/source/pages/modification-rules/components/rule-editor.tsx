import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { protocolOptions, type ModificationRule, type RuleStage } from '../types'

interface RuleEditorProps {
  rule: ModificationRule
  dirty: boolean
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
    <div className="space-y-7 px-5 py-5">
      <div className="min-w-0 rounded-lg bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{rule.name || '未命名规则'}</h2>
          <Badge variant={rule.stage === 'request' ? 'info' : 'warning'} className="font-normal">
            {rule.stage === 'request' ? '请求阶段' : '响应阶段'}
          </Badge>
          {!rule.enabled && <Badge variant="muted" className="font-normal">已停用</Badge>}
          {props.dirty && <span className="text-[11px] text-warning">有未保存更改</span>}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {rule.global ? '自动应用到所有匹配请求' : `已在 ${rule.boundProviders} 个供应商中生效`} · 更新于 {rule.updatedAt}
        </p>
      </div>

      <section className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xs font-semibold">基本信息</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">定义规则的作用范围、执行阶段与全局启用状态。</p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="rule-enabled" className="text-[11px] text-muted-foreground">启用规则</Label>
              <Switch id="rule-enabled" checked={rule.enabled} onCheckedChange={enabled => update({ enabled })} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name" className="text-[11px]">规则名称</Label>
              <Input id="rule-name" value={rule.name} onChange={event => update({ name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">执行阶段</Label>
              <Tabs value={rule.stage} onValueChange={value => update({ stage: value as RuleStage })}>
                <TabsList className="grid h-9 w-full grid-cols-2">
                  <TabsTrigger value="request" className="text-xs">上游请求</TabsTrigger>
                  <TabsTrigger value="response" className="text-xs">客户端响应</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="rule-description" className="text-[11px]">说明</Label>
              <Input
                id="rule-description"
                value={rule.description}
                onChange={event => update({ description: event.target.value })}
                placeholder="说明这条规则解决什么兼容问题"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2.5 md:col-span-2">
              <div>
                <Label htmlFor="rule-global" className="text-[11px] font-medium">全局规则</Label>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  开启后自动应用到所有匹配请求；关闭后需要在供应商管理中添加才会生效。
                </p>
              </div>
              <Switch id="rule-global" checked={rule.global} onCheckedChange={global => update({ global })} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold">匹配条件</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">仅按协议匹配；不选择表示适用于全部协议。</p>
          </div>
          <div className="rounded-lg bg-muted/35 p-4">
            <div className="space-y-1.5">
              <Label className="text-[11px]">适用协议</Label>
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
                        'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                        selected ? 'bg-primary/12 text-primary' : 'bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {protocol}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} />

      <section className="rounded-lg bg-primary/8 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold">规则摘要</h3>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              当{rule.protocols.length ? `协议为 ${rule.protocols.join('、')}` : '任意协议'}时，
              在{rule.stage === 'request' ? '发送到真实 Provider 前' : '返回客户端前'}按顺序执行 {rule.actions.length} 个修改动作。
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono font-normal">v1 · 结构化规则</Badge>
        </div>
      </section>
    </div>
  )
}
