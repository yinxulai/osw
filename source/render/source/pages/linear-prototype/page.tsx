import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Command,
  Copy,
  Database,
  Gauge,
  History,
  Layers3,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Waypoints,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import './prototype.css'

type ViewKey = 'overview' | 'routes' | 'providers' | 'requests'

interface NavigationItem {
  key: ViewKey
  label: string
  icon: LucideIcon
  count?: number
}

const navigation: NavigationItem[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'routes', label: 'Model routes', icon: Waypoints, count: 4 },
  { key: 'providers', label: 'Providers', icon: Boxes, count: 6 },
  { key: 'requests', label: 'Requests', icon: History },
]

const routes = [
  { model: 'claude-3.7-sonnet', provider: 'Anthropic', fallback: 'OpenRouter', latency: '684 ms', health: 99.98 },
  { model: 'gpt-4.1', provider: 'OpenAI', fallback: 'Azure OpenAI', latency: '521 ms', health: 99.96 },
  { model: 'gemini-2.5-pro', provider: 'Google AI', fallback: 'OpenRouter', latency: '798 ms', health: 99.91 },
  { model: 'deepseek-v3', provider: 'DeepSeek', fallback: 'Volcengine', latency: '432 ms', health: 99.87 },
]

const requests = [
  { time: '14:32:08', model: 'claude-3.7-sonnet', provider: 'Anthropic', tokens: '2,841', latency: '648 ms', status: 200 },
  { time: '14:31:52', model: 'gpt-4.1', provider: 'OpenAI', tokens: '1,204', latency: '493 ms', status: 200 },
  { time: '14:31:41', model: 'gemini-2.5-pro', provider: 'Google AI', tokens: '8,192', latency: '1.24 s', status: 200 },
  { time: '14:30:57', model: 'claude-3.7-sonnet', provider: 'OpenRouter', tokens: '3,067', latency: '932 ms', status: 200 },
  { time: '14:30:18', model: 'deepseek-v3', provider: 'DeepSeek', tokens: '986', latency: '418 ms', status: 200 },
]

const chartValues = [34, 43, 39, 54, 49, 61, 57, 67, 73, 66, 79, 76, 84, 77, 89, 93, 86, 98, 94, 103, 96, 112, 108, 118]

function MiniChart() {
  const width = 640
  const height = 136
  const points = chartValues.map((value, index) => {
    const x = (index / (chartValues.length - 1)) * width
    const y = height - ((value - 25) / 100) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="lp-chart" aria-label="Request volume over the last 24 hours">
      <div className="lp-chart-grid" />
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id="requestArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a1a1a6" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#a1a1a6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#requestArea)" />
        <polyline points={points} fill="none" stroke="#a1a1a6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="lp-chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span></div>
    </div>
  )
}

function LinearPrototypePage() {
  const [activeView, setActiveView] = useState<ViewKey>('overview')
  const [copied, setCopied] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const copyUrl = async () => {
    await navigator.clipboard?.writeText('http://127.0.0.1:3000/v1')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="lp-shell">
      <aside className="lp-sidebar">
        <div className="lp-window-drag"><span /><span /><span /></div>
        <button className="lp-workspace" type="button">
          <span className="lp-logo"><Layers3 size={14} /></span>
          <span>One Switch</span>
          <ChevronDown size={13} />
        </button>

        <button className="lp-search" type="button" onClick={() => setCommandOpen(true)}>
          <Search size={13} /><span>Search</span><kbd>⌘ K</kbd>
        </button>

        <nav className="lp-nav" aria-label="Primary navigation">
          <p>Workspace</p>
          {navigation.map(item => {
            const Icon = item.icon
            return (
              <button
                className={activeView === item.key ? 'is-active' : ''}
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={14} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}
              </button>
            )
          })}
          <p>System</p>
          <button type="button"><TerminalSquare size={14} /><span>Runtime logs</span></button>
          <button type="button"><Settings2 size={14} /><span>Settings</span></button>
        </nav>

        <div className="lp-sidebar-footer">
          <div className="lp-service-state">
            <span className="lp-pulse"><i /></span>
            <div><strong>Gateway online</strong><small>127.0.0.1:3000</small></div>
            <MoreHorizontal size={15} />
          </div>
          <div className="lp-profile"><span>YL</span><div><strong>Local workspace</strong><small>Version 0.1.3</small></div></div>
        </div>
      </aside>

      <main className="lp-main">
        <header className="lp-topbar">
          <div><span>Workspace</span><ChevronRight size={13} /><strong>{navigation.find(item => item.key === activeView)?.label}</strong></div>
          <div className="lp-top-actions">
            <button type="button"><Activity size={14} /> Live</button>
            <button className="lp-primary-button" type="button"><Plus size={14} /> New route</button>
          </div>
        </header>

        <div className="lp-content">
          <section className="lp-heading">
            <div>
              <p className="lp-eyebrow"><Sparkles size={12} /> Local AI gateway</p>
              <h1>{activeView === 'overview' ? 'Good afternoon.' : navigation.find(item => item.key === activeView)?.label}</h1>
              <p>{activeView === 'overview' ? 'Your models are healthy and traffic is flowing normally.' : 'Inspect and control your local gateway configuration.'}</p>
            </div>
            <div className="lp-period"><button className="is-active" type="button">24h</button><button type="button">7d</button><button type="button">30d</button></div>
          </section>

          <section className="lp-endpoint">
            <div className="lp-endpoint-icon"><Zap size={16} /></div>
            <div><span>OpenAI-compatible endpoint</span><code>http://127.0.0.1:3000/v1</code></div>
            <button type="button" onClick={copyUrl}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>
          </section>

          <section className="lp-metrics">
            <article><div><span>Requests today</span><Activity size={14} /></div><strong>12,482</strong><small className="is-up"><ArrowUpRight size={12} /> 8.2% <i>from yesterday</i></small></article>
            <article><div><span>Success rate</span><Circle size={14} /></div><strong>99.97%</strong><small className="is-up"><ArrowUpRight size={12} /> 0.06% <i>from yesterday</i></small></article>
            <article><div><span>Median latency</span><Clock3 size={14} /></div><strong>612 <em>ms</em></strong><small className="is-down"><ArrowDownRight size={12} /> 42 ms <i>faster</i></small></article>
            <article><div><span>Tokens routed</span><Database size={14} /></div><strong>8.4 <em>M</em></strong><small className="is-up"><ArrowUpRight size={12} /> 12.4% <i>this period</i></small></article>
          </section>

          <section className="lp-dashboard-grid">
            <article className="lp-panel lp-traffic">
              <header><div><h2>Request volume</h2><p>Requests routed through your gateway</p></div><span><i /> Live</span></header>
              <div className="lp-chart-total"><strong>12,482</strong><span>requests</span></div>
              <MiniChart />
            </article>

            <article className="lp-panel lp-health">
              <header><div><h2>Provider health</h2><p>Last checked seconds ago</p></div><button type="button"><MoreHorizontal size={15} /></button></header>
              <div className="lp-provider-list">
                {[
                  ['Anthropic', 'Operational', '99.99%'],
                  ['OpenAI', 'Operational', '99.97%'],
                  ['Google AI', 'Operational', '99.95%'],
                  ['OpenRouter', 'Degraded', '98.42%'],
                ].map(([name, state, uptime]) => (
                  <div key={name}><span className="lp-provider-mark">{name.slice(0, 1)}</span><div><strong>{name}</strong><small className={state === 'Degraded' ? 'is-warning' : ''}><i /> {state}</small></div><em>{uptime}</em></div>
                ))}
              </div>
              <button className="lp-view-all" type="button" onClick={() => setActiveView('providers')}>View all providers <ChevronRight size={13} /></button>
            </article>
          </section>

          <section className="lp-panel lp-routes">
            <header><div><h2>Active model routes</h2><p>Primary providers and automatic fallbacks</p></div><button type="button"><SlidersHorizontal size={14} /> Filter</button></header>
            <div className="lp-table-scroll">
              <table>
                <thead><tr><th>Model</th><th>Primary provider</th><th>Fallback</th><th>Latency</th><th>Health</th><th /></tr></thead>
                <tbody>
                  {routes.map(route => (
                    <tr key={route.model}>
                      <td><span className="lp-model-icon"><Layers3 size={12} /></span><code>{route.model}</code></td>
                      <td><i className="lp-status-dot" />{route.provider}</td>
                      <td>{route.fallback}</td><td><code>{route.latency}</code></td><td><span className="lp-health-bar"><i style={{ width: `${route.health}%` }} /></span>{route.health}%</td>
                      <td><button type="button"><MoreHorizontal size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lp-panel lp-recent">
            <header><div><h2>Recent requests</h2><p>Latest traffic across all configured models</p></div><button type="button" onClick={() => setActiveView('requests')}>View requests <ChevronRight size={13} /></button></header>
            <div className="lp-table-scroll">
              <table>
                <thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Tokens</th><th>Latency</th><th>Status</th></tr></thead>
                <tbody>{requests.map(request => <tr key={`${request.time}-${request.model}`}><td><code>{request.time}</code></td><td><code>{request.model}</code></td><td>{request.provider}</td><td>{request.tokens}</td><td>{request.latency}</td><td><span className="lp-status"><i /> {request.status}</span></td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </main>

      {commandOpen && (
        <div className="lp-command-backdrop" role="presentation" onMouseDown={() => setCommandOpen(false)}>
          <div className="lp-command" role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={event => event.stopPropagation()}>
            <div><Search size={16} /><input autoFocus placeholder="Search or jump to..." onKeyDown={event => event.key === 'Escape' && setCommandOpen(false)} /><kbd>ESC</kbd></div>
            <p>Quick actions</p>
            <button type="button"><Play size={14} /><span>Test a model route</span><kbd>↵</kbd></button>
            <button type="button"><Plus size={14} /><span>Create new route</span></button>
            <button type="button"><Command size={14} /><span>Open command settings</span></button>
          </div>
        </div>
      )}
    </div>
  )
}

export { LinearPrototypePage }
