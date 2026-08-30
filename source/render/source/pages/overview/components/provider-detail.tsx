import { BarChart3, CheckCircle2, Clock3, Coins, TriangleAlert } from 'lucide-react'
import type { AnalyticsRange, ModelStat, ProviderStat } from '@common/schemas'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { Badge } from '@/components/ui/badge'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { formatLatency, formatTokens } from '../lib/format'
import { getProviderRequestTrend, getProviderTokenTrend } from '../lib/provider-mock'

interface ProviderDetailProps {
  provider: ProviderStat
  models: ModelStat[]
  range: AnalyticsRange
}

const requestConfig = {
  success: { label: '成功', color: 'hsl(var(--success))' },
  failed: { label: '失败', color: 'hsl(var(--destructive))' },
  successRate: { label: '成功率', color: 'hsl(var(--primary))' },
} satisfies ChartConfig

const tokenConfig = {
  inputTokens: { label: '输入', color: 'hsl(var(--success))' },
  outputTokens: { label: '输出', color: '#0891b2' },
  cachedInputTokens: { label: '缓存读取', color: '#14b8a6' },
  cacheCreationInputTokens: { label: '缓存写入', color: '#f59e0b' },
  reasoningTokens: { label: '思考', color: '#64748b' },
} satisfies ChartConfig

export function ProviderDetail(props: ProviderDetailProps) {
  const requestTrend = getProviderRequestTrend(props.provider, props.range)
  const tokenTrend = getProviderTokenTrend(props.provider, props.range)
  const providerModels = props.models.filter(model => model.providerId === props.provider.providerId)
  const totalTokens = tokenTrend.reduce((sum, item) => sum + item.inputTokens + item.outputTokens + item.cachedInputTokens + item.cacheCreationInputTokens + item.reasoningTokens, 0)

  return (
    <div className="space-y-4">
      <MetricGrid className="sm:grid-cols-5" items={[
        { label: '请求数', value: props.provider.requests.toLocaleString(), Icon: BarChart3 },
        { label: '成功率', value: `${props.provider.requests ? ((props.provider.success / props.provider.requests) * 100).toFixed(1) : '0.0'}%`, Icon: CheckCircle2 },
        { label: '失败数', value: props.provider.failed.toLocaleString(), Icon: TriangleAlert },
        { label: '平均延迟', value: formatLatency(props.provider.avgLatencyMs), Icon: Clock3 },
        { label: 'Token 用量', value: formatTokens(totalTokens), Icon: Coins },
      ]} />

      <Card>
        <CardSectionHeader title="请求质量" description={props.range === 'today' ? '15 分钟粒度 · 柱状图为请求数，折线为成功率' : '每日统计 · 柱状图为请求数，折线为成功率'} compact />
        <CardContent>
          <ChartContainer config={requestConfig} className="h-56 w-full">
            <LineChart data={requestTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis yAxisId="requests" tickLine={false} axisLine={false} width={38} allowDecimals={false} fontSize={11} />
              <YAxis yAxisId="rate" orientation="right" domain={[0, 1]} tickLine={false} axisLine={false} width={38} tickFormatter={value => `${Math.round(Number(value) * 100)}%`} fontSize={11} />
              <Tooltip formatter={(value, name) => name === 'successRate' ? `${(Number(value) * 100).toFixed(1)}%` : value} />
              <Bar yAxisId="requests" dataKey="success" stackId="requests" fill="var(--color-success)" />
              <Bar yAxisId="requests" dataKey="failed" stackId="requests" fill="var(--color-failed)" radius={[3, 3, 0, 0]} />
              <Line yAxisId="rate" type="monotone" dataKey="successRate" stroke="var(--color-successRate)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardSectionHeader title="Token 构成" description={props.range === 'today' ? '15 分钟粒度 · 输入、输出与缓存用量' : '每日统计 · 输入、输出与缓存用量'} compact />
          <CardContent>
            <ChartContainer config={tokenConfig} className="h-48 w-full">
              <BarChart data={tokenTrend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={42} tickFormatter={value => formatTokens(Number(value))} fontSize={11} />
                <Tooltip formatter={value => formatTokens(Number(value))} />
                <Bar dataKey="inputTokens" stackId="tokens" fill="var(--color-inputTokens)" />
                <Bar dataKey="cachedInputTokens" stackId="tokens" fill="var(--color-cachedInputTokens)" />
                <Bar dataKey="outputTokens" stackId="tokens" fill="var(--color-outputTokens)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardSectionHeader title="延迟表现" description="成功请求的平均延迟" compact />
          <CardContent>
            <div className="mb-3 flex items-end justify-between">
              <div><div className="text-2xl font-medium tabular-nums">{formatLatency(props.provider.avgLatencyMs)}</div><div className="mt-1 text-[11px] text-muted-foreground">时间范围平均响应</div></div>
              <Clock3 className="size-5 text-muted-foreground" />
            </div>
            <ChartContainer config={{ avgLatencyMs: { label: '平均延迟', color: 'hsl(var(--warning))' } }} className="h-24 w-full">
              <LineChart data={requestTrend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip formatter={value => formatLatency(Number(value))} />
                <Line type="monotone" dataKey="avgLatencyMs" stroke="var(--color-avgLatencyMs)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardSectionHeader title="模型表现" description="按请求量排序 · 用于定位具体模型的质量差异" compact />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">模型</th><th className="px-3 py-2 text-right font-medium">请求数</th><th className="px-3 py-2 text-right font-medium">成功率</th><th className="px-3 py-2 text-right font-medium">平均延迟</th><th className="px-4 py-2 text-right font-medium">TPS</th></tr></thead>
              <tbody>{providerModels.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">暂无模型数据</td></tr> : providerModels.map(model => (
                <tr key={model.providerModelName} className="border-t border-border/50">
                  <td className="max-w-52 truncate px-4 py-2.5 font-medium">{model.providerModelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.requests.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right"><Badge variant={model.successRate >= 0.95 ? 'success' : model.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 text-[11px] font-normal">{(model.successRate * 100).toFixed(1)}%</Badge></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatLatency(model.avgLatencyMs)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{model.avgTps == null ? '—' : model.avgTps.toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardSectionHeader title="供应商状态" description="基于当前时间范围内的最终请求结果" compact />
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
          <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-success" />运行稳定</div>
          <div className="text-muted-foreground">成功 {props.provider.success.toLocaleString()} 次</div>
          <div className={cn(props.provider.failed > 0 ? 'text-warning' : 'text-muted-foreground')}>失败 {props.provider.failed.toLocaleString()} 次</div>
          <Button variant="outline" size="sm" className="ml-auto h-7" disabled>查看请求记录</Button>
        </CardContent>
      </Card>
    </div>
  )
}
