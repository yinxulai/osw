import { useState } from 'react'
import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'

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
    { name: 'OpenAI', requests: 8420, percent: 34, color: '#10a37f' },
    { name: 'Anthropic', requests: 6150, percent: 25, color: '#d97757' },
    { name: 'DeepSeek', requests: 4920, percent: 20, color: '#4d6bfe' },
    { name: 'Gemini', requests: 2460, percent: 10, color: '#4285f4' },
    { name: 'Ollama', requests: 2630, percent: 11, color: '#202225' },
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
    <div>
      <div className="page-header">
        <div>
          <h2>统计分析</h2>
          <p>请求量、成功率、延迟等核心指标统计</p>
        </div>
        <div className="flex gap-2">
          {(['today', '7d', '30d'] as const).map(range => (
            <button
              key={range}
              className={`btn btn-sm ${timeRange === range ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTimeRange(range)}
            >
              {range === 'today' ? '今日' : range === '7d' ? '近 7 天' : '近 30 天'}
            </button>
          ))}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="stat-grid">
        {stats.map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">
              <s.Icon size={16} />
              {s.label}
            </div>
            <div className="stat-value">{s.value}</div>
            <div className={`stat-trend ${s.trendUp ? 'up' : 'down'}`}>
              {s.trend} 较上周
            </div>
          </div>
        ))}
      </div>

      {/* 请求趋势 + Provider 分布 */}
      <div className="chart-row-2-1">
        {/* 请求量趋势 */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">请求量趋势</div>
              <div className="card-desc">每日请求数</div>
            </div>
          </div>
          <div style={{ height: 220, display: 'flex', alignItems: 'flex-end', gap: 12, padding: '16px 8px 0' }}>
            {requestTrend.map(d => (
              <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', height: 170, gap: 2 }}>
                  <div
                    style={{
                      height: `${(d.requests / maxRequests) * 100}%`,
                      background: 'linear-gradient(to top, var(--primary), var(--primary-light))',
                      borderRadius: '4px 4px 0 0',
                      minHeight: 4,
                    }}
                  />
                </div>
                <div className="text-sm text-muted">{d.day}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Provider 使用分布 */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Provider 分布</div>
              <div className="card-desc">按请求量占比</div>
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {providerUsage.map(p => (
              <div key={p.name} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="text-sm">{p.name}</span>
                  <span className="text-sm text-muted">{p.percent}% · {p.requests.toLocaleString()}</span>
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${p.percent}%`, height: '100%', background: p.color, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 模型排行 + 延迟分布 */}
      <div className="chart-row-3-2 mt-4">
        {/* 模型使用排行 */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">模型使用排行</div>
              <div className="card-desc">按请求数排序</div>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>模型</th>
                <th>Provider</th>
                <th>请求数</th>
                <th>平均延迟</th>
                <th>成功率</th>
              </tr>
            </thead>
            <tbody>
              {modelRanking.map((m, idx) => (
                <tr key={m.model}>
                  <td>
                    <span style={{
                      display: 'inline-flex',
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: idx < 3 ? 'var(--primary)' : 'var(--bg-secondary)',
                      color: idx < 3 ? 'white' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className="text-bold">{m.model}</td>
                  <td className="text-muted text-sm">{m.provider}</td>
                  <td>{m.requests.toLocaleString()}</td>
                  <td>{m.avgLatency}</td>
                  <td>
                    <span className="badge badge-success">{m.successRate}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 延迟分布 */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">延迟分布</div>
              <div className="card-desc">响应时间区间占比</div>
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {latencyDistribution.map(l => (
              <div key={l.range} style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 50, fontSize: 13, color: 'var(--text-muted)' }}>{l.range}</div>
                <div style={{ flex: 1, height: 24, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    width: `${l.percent}%`,
                    height: '100%',
                    background: l.percent > 30 ? 'var(--success)' : l.percent > 10 ? 'var(--warning)' : 'var(--error)',
                    borderRadius: 4,
                    opacity: 0.7,
                  }} />
                  <span style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 12,
                    fontWeight: 500,
                  }}>
                    {l.percent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 失败原因分析 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">失败原因分析</div>
            <div className="card-desc">共 286 次失败请求 · 失败率 1.16%</div>
          </div>
        </div>
        <div className="failure-grid">
          {failureReasons.map(f => (
            <div key={f.reason} style={{
              padding: 16,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--error)', marginBottom: 4 }}>{f.count}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{f.reason}</div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${f.percent}%`, height: '100%', background: 'var(--error)', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{f.percent}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
