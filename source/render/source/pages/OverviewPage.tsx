import { useState } from 'react'
import { BarChart3, CheckCircle2, Zap, Coins, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function OverviewPage() {
  const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d'>('7d')

  const stats = [
    { label: '总请求数', value: '24,580', trend: '+18.3%', trendUp: true, Icon: BarChart3 },
    { label: '成功率', value: '99.1%', trend: '+0.5%', trendUp: true, Icon: CheckCircle2 },
    { label: '平均响应', value: '2.1s', trend: '-0.3s', trendUp: true, Icon: Zap },
    { label: 'Token 消耗', value: '48.2M', trend: '+22.7%', trendUp: false, Icon: Coins },
  ]

  const requestTrend = [
    { day: '周一', requests: 2800 },
    { day: '周二', requests: 3200 },
    { day: '周三', requests: 2900 },
    { day: '周四', requests: 3500 },
    { day: '周五', requests: 4100 },
    { day: '周六', requests: 3800 },
    { day: '周日', requests: 4280 },
  ]
  const maxRequests = Math.max(...requestTrend.map(d => d.requests))

  const providerUsage = [
    { name: 'OpenAI', requests: 8420, percent: 34, color: 'bg-emerald-500' },
    { name: 'Anthropic', requests: 6150, percent: 25, color: 'bg-orange-500' },
    { name: 'DeepSeek', requests: 4920, percent: 20, color: 'bg-indigo-500' },
    { name: 'Gemini', requests: 2460, percent: 10, color: 'bg-blue-500' },
    { name: 'Ollama', requests: 2630, percent: 11, color: 'bg-zinc-700' },
  ]

  const modelRanking = [
    { model: 'gpt-4o', provider: 'OpenAI', requests: 6240, avgLatency: '1.2s', successRate: '99.8%' },
    { model: 'claude-3-5-sonnet', provider: 'Anthropic', requests: 5120, avgLatency: '2.1s', successRate: '99.5%' },
    { model: 'deepseek-chat', provider: 'DeepSeek', requests: 4920, avgLatency: '3.8s', successRate: '97.2%' },
    { model: 'gpt-4o-mini', provider: 'OpenAI', requests: 2180, avgLatency: '0.6s', successRate: '99.9%' },
    { model: 'qwen2.5:72b', provider: 'Ollama', requests: 1850, avgLatency: '3.5s', successRate: '99.9%' },
  ]

  const latencyDistribution = [
    { range: '< 1s', count: 8200, percent: 33 },
    { range: '1-2s', count: 9800, percent: 40 },
    { range: '2-3s', count: 4100, percent: 17 },
    { range: '3-5s', count: 1900, percent: 8 },
    { range: '> 5s', count: 580, percent: 2 },
  ]

  const failureReasons = [
    { reason: '超时', count: 128, percent: 45 },
    { reason: '限流 (429)', count: 86, percent: 30 },
    { reason: '服务错误 (5xx)', count: 42, percent: 15 },
    { reason: '认证失败', count: 18, percent: 6 },
    { reason: '其他', count: 12, percent: 4 },
  ]

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">统计分析</h1>
          <p className="text-sm text-muted-foreground mt-1">请求量、成功率、延迟等核心指标统计</p>
        </div>
        <Tabs value={timeRange} onValueChange={v => setTimeRange(v as typeof timeRange)}>
          <TabsList className="h-8">
            <TabsTrigger value="today" className="h-7 px-3 text-xs">今日</TabsTrigger>
            <TabsTrigger value="7d" className="h-7 px-3 text-xs">近 7 天</TabsTrigger>
            <TabsTrigger value="30d" className="h-7 px-3 text-xs">近 30 天</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <s.Icon size={16} />
                {s.label}
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className={cn(
                'flex items-center gap-1 text-xs mt-1.5',
                s.trendUp ? 'text-success' : 'text-destructive'
              )}>
                {s.trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {s.trend} 较上周
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 请求趋势 + Provider 分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* 请求量趋势 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">请求量趋势</CardTitle>
            <CardDescription>每日请求数</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56 flex items-end gap-3 pt-4">
              {requestTrend.map(d => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex flex-col-reverse h-44 gap-1">
                    <div
                      className="w-full bg-gradient-to-t from-primary to-primary/60 rounded-t-md transition-all"
                      style={{ height: `${(d.requests / maxRequests) * 100}%`, minHeight: 4 }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">{d.day}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Provider 使用分布 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Provider 分布</CardTitle>
            <CardDescription>按请求量占比</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {providerUsage.map(p => (
              <div key={p.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {p.percent}% · {p.requests.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', p.color)} style={{ width: `${p.percent}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 模型排行 + 延迟分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
        {/* 模型使用排行 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">模型使用排行</CardTitle>
            <CardDescription>按请求数排序</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left font-medium py-2.5 w-10">#</th>
                    <th className="text-left font-medium py-2.5">模型</th>
                    <th className="text-left font-medium py-2.5">Provider</th>
                    <th className="text-right font-medium py-2.5">请求数</th>
                    <th className="text-right font-medium py-2.5">平均延迟</th>
                    <th className="text-right font-medium py-2.5">成功率</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRanking.map((m, idx) => (
                    <tr key={m.model} className="border-b last:border-0">
                      <td className="py-3">
                        <span className={cn(
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                          idx < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3 font-medium">{m.model}</td>
                      <td className="py-3 text-muted-foreground">{m.provider}</td>
                      <td className="py-3 text-right">{m.requests.toLocaleString()}</td>
                      <td className="py-3 text-right">{m.avgLatency}</td>
                      <td className="py-3 text-right">
                        <Badge variant="success" className="font-normal">{m.successRate}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 延迟分布 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">延迟分布</CardTitle>
            <CardDescription>响应时间区间占比</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {latencyDistribution.map(l => (
              <div key={l.range} className="flex items-center gap-3">
                <div className="w-12 text-xs text-muted-foreground shrink-0">{l.range}</div>
                <div className="flex-1 relative h-7 bg-muted rounded-md overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-md opacity-80',
                      l.percent > 30 ? 'bg-success' : l.percent > 10 ? 'bg-warning' : 'bg-destructive'
                    )}
                    style={{ width: `${l.percent}%` }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">
                    {l.percent}%
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 失败原因分析 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">失败原因分析</CardTitle>
          <CardDescription>共 286 次失败请求 · 失败率 1.16%</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {failureReasons.map(f => (
              <div key={f.reason} className="rounded-lg border bg-muted/30 p-4 text-center">
                <div className="text-2xl font-bold text-destructive mb-1">{f.count}</div>
                <div className="text-sm text-muted-foreground mb-2">{f.reason}</div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-destructive rounded-full" style={{ width: `${f.percent}%` }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">{f.percent}%</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
