import { useState } from 'react'
import {
  Activity,
  BotMessageSquare,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  FlaskConical,
  GripVertical,
  History,
  MessageSquareCode,
  MoreHorizontal,
  Pause,
  Plug,
  RefreshCw,
  Settings2,
  Sparkles,
  TerminalSquare,
  Timer,
  Waypoints,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import './prototype.css'

type ViewKey = 'queue' | 'providers' | 'requests' | 'analytics'
type ProtocolKey = 'completions' | 'responses' | 'messages'
type QueueMode = 'auto' | 'manual'

interface NavigationItem {
  key: ViewKey
  label: string
  icon: LucideIcon
}

interface QueueItem {
  id: string
  priority: number
  provider: string
  model: string
  protocols: ProtocolKey[]
  tps: string
  ttft: string
  samples: number
  health: string
  state: 'ready' | 'cooling' | 'disabled'
  enabled: boolean
}

const navigation: NavigationItem[] = [
  { key: 'queue', label: '模型队列', icon: Waypoints },
  { key: 'providers', label: '模型管理', icon: Plug },
  { key: 'analytics', label: '统计分析', icon: Activity },
  { key: 'requests', label: '请求记录', icon: History },
]

const protocolMeta: Record<ProtocolKey, { label: string; path: string; icon: LucideIcon }> = {
  completions: { label: 'OpenAI Completions', path: '/v1/chat/completions', icon: MessageSquareCode },
  responses: { label: 'OpenAI Responses', path: '/v1/responses', icon: Sparkles },
  messages: { label: 'Anthropic Messages', path: '/v1/messages', icon: BotMessageSquare },
}

const initialQueue: QueueItem[] = [
  { id: 'anthropic', priority: 1, provider: 'Anthropic', model: 'claude-sonnet-4-20250514', protocols: ['messages'], tps: '46.2', ttft: '0.58s', samples: 20, health: '最后成功 18 秒前', state: 'ready', enabled: true },
  { id: 'openrouter', priority: 2, provider: 'OpenRouter', model: 'anthropic/claude-sonnet-4', protocols: ['completions'], tps: '38.7', ttft: '0.81s', samples: 20, health: '最后成功 6 分钟前', state: 'ready', enabled: true },
  { id: 'volcengine', priority: 3, provider: 'Volcengine', model: 'doubao-seed-1-6-250615', protocols: ['completions', 'responses'], tps: '52.4', ttft: '0.42s', samples: 14, health: '冷却至 14:38', state: 'cooling', enabled: true },
  { id: 'deepseek', priority: 4, provider: 'DeepSeek', model: 'deepseek-chat', protocols: ['completions'], tps: '31.8', ttft: '0.67s', samples: 18, health: '已手动禁用', state: 'disabled', enabled: false },
]

const recentRequests = [
  { id: 'req_8fa21c', time: '14:32:08', protocol: 'Anthropic Messages', route: ['Anthropic'], result: '成功', attempts: 1, duration: '1.84s' },
  { id: 'req_8fa18d', time: '14:29:41', protocol: 'OpenAI Completions', route: ['Volcengine', 'OpenRouter'], result: '切换成功', attempts: 2, duration: '2.31s' },
  { id: 'req_8fa102', time: '14:27:16', protocol: 'OpenAI Responses', route: ['Volcengine', 'Anthropic'], result: '切换成功', attempts: 2, duration: '3.08s' },
  { id: 'req_8f9fcd', time: '14:22:53', protocol: 'Anthropic Messages', route: ['Anthropic'], result: '成功', attempts: 1, duration: '1.42s' },
]

interface ProtocolIconsProps {
  protocols: ProtocolKey[]
}

function ProtocolIcons(props: ProtocolIconsProps) {
  const { protocols } = props
  return <span className="lp-protocol-icons">{protocols.map(protocol => {
    const Icon = protocolMeta[protocol].icon
    return <span key={protocol} title={protocolMeta[protocol].label}><Icon size={11} /></span>
  })}</span>
}

function LinearPrototypePage() {
  const [activeView, setActiveView] = useState<ViewKey>('queue')
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolKey>('completions')
  const [mode, setMode] = useState<QueueMode>('auto')
  const [manualModelId, setManualModelId] = useState('anthropic')
  const [queue, setQueue] = useState(initialQueue)
  const [copied, setCopied] = useState(false)

  const endpoint = `http://127.0.0.1:9300${protocolMeta[selectedProtocol].path}`
  const enabledCount = queue.filter(item => item.enabled).length
  const coolingCount = queue.filter(item => item.state === 'cooling').length

  const copyEndpoint = async () => {
    await navigator.clipboard?.writeText(endpoint)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const toggleQueueItem = (id: string) => {
    setQueue(items => items.map(item => item.id === id
      ? { ...item, enabled: !item.enabled, state: item.enabled ? 'disabled' : 'ready', health: item.enabled ? '已手动禁用' : '等待首次请求' }
      : item))
  }

  return (
    <div className="lp-shell">
      <aside className="lp-sidebar">
        <div className="lp-window-drag"><span /><span /><span /></div>
        <button className="lp-workspace" type="button">
          <img className="lp-logo" src="icon.svg" alt="" />
          <span>One Switch</span>
          <ChevronDown size={13} />
        </button>

        <nav className="lp-nav" aria-label="主导航">
          <p>控制台</p>
          {navigation.map(item => {
            const Icon = item.icon
            return <button className={activeView === item.key ? 'is-active' : ''} key={item.key} type="button" onClick={() => setActiveView(item.key)}><Icon size={14} /><span>{item.label}</span></button>
          })}
          <p>系统</p>
          <button type="button"><TerminalSquare size={14} /><span>运行日志</span></button>
          <button type="button"><Settings2 size={14} /><span>设置</span></button>
        </nav>

        <div className="lp-sidebar-footer">
          <div className="lp-service-state"><span className="lp-pulse"><i /></span><div><strong>服务运行中</strong><small>127.0.0.1:9300</small></div><MoreHorizontal size={15} /></div>
          <div className="lp-local-note"><span>本地</span><p>配置、密钥和日志仅保存在此设备</p></div>
        </div>
      </aside>

      <main className="lp-main">
        <header className="lp-topbar">
          <div><span>控制台</span><ChevronRight size={13} /><strong>{navigation.find(item => item.key === activeView)?.label}</strong></div>
          <div className="lp-top-actions">
            <button type="button"><FlaskConical size={14} /> 全局测试</button>
            <button className="lp-primary-button" type="button"><Plug size={14} /> 模型管理</button>
          </div>
        </header>

        <div className="lp-content lp-product-content">
          <section className="lp-product-heading">
            <div><h1>模型队列</h1><p>管理上游模型的优先级、可用状态和故障转移顺序。</p></div>
            <button type="button" className="lp-pause-button"><Pause size={13} /> 暂停服务</button>
          </section>

          <section className="lp-service-panel">
            <div className="lp-service-summary">
              <span className="lp-service-icon"><Zap size={15} /></span>
              <div><div className="lp-running"><i /> 本地代理服务运行中</div><p>所有请求仅在本机处理，上游 API Key 在模型管理中独立配置。</p></div>
              <code>127.0.0.1:9300</code>
            </div>
            <div className="lp-endpoint-row">
              <div className="lp-protocol-select">
                {Object.entries(protocolMeta).map(([key, meta]) => {
                  const Icon = meta.icon
                  return <button className={selectedProtocol === key ? 'is-active' : ''} key={key} type="button" onClick={() => setSelectedProtocol(key as ProtocolKey)}><Icon size={12} /><span>{meta.label}</span></button>
                })}
              </div>
              <code className="lp-endpoint-value">{endpoint}</code>
              <button className="lp-copy-button" type="button" onClick={copyEndpoint}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制地址'}</button>
            </div>
          </section>

          <section className="lp-queue-panel">
            <header>
              <div><div className="lp-title-line"><h2>优先级队列</h2><code>default</code></div><p>{queue.length} 个模型 · {enabledCount} 个已启用{coolingCount > 0 && <span> · {coolingCount} 个冷却中</span>}</p></div>
              <div className="lp-queue-actions">
                <div className="lp-mode-switch"><button className={mode === 'auto' ? 'is-active' : ''} type="button" onClick={() => setMode('auto')}><RefreshCw size={11} /> 自动转移</button><button className={mode === 'manual' ? 'is-active' : ''} type="button" onClick={() => setMode('manual')}><CircleDot size={11} /> 手动指定</button></div>
                <button type="button"><FlaskConical size={12} /> 全局测试</button>
              </div>
            </header>

            <div className="lp-queue-columns"><span>顺序</span><span>供应商与上游模型</span><span>协议</span><span>性能</span><span>健康状态</span><span>状态</span></div>
            <div className="lp-queue-list">
              {queue.map(item => {
                const selected = mode === 'manual' && manualModelId === item.id
                return (
                  <button className={`lp-queue-item ${selected ? 'is-selected' : ''}`} key={item.id} type="button" onClick={() => mode === 'manual' && item.enabled && item.state !== 'cooling' && setManualModelId(item.id)}>
                    <span className="lp-priority">{mode === 'auto' ? <GripVertical size={13} /> : <CircleDot size={13} />}<i>{item.priority}</i></span>
                    <span className="lp-model-cell"><strong>{item.provider}</strong><code>{item.model}</code></span>
                    <ProtocolIcons protocols={item.protocols} />
                    <span className="lp-performance"><span><Zap size={10} /> TPS {item.tps}</span><span><Timer size={10} /> TTFT {item.ttft}</span><small>近 {item.samples} 次</small></span>
                    <span className={`lp-health-state is-${item.state}`}><i />{item.health}</span>
                    <span className="lp-item-controls"><em className={`is-${item.state}`}>{selected ? '当前指定' : item.state === 'ready' ? '待命' : item.state === 'cooling' ? '冷却中' : '已禁用'}</em><span className={`lp-toggle ${item.enabled ? 'is-on' : ''}`} role="switch" aria-checked={item.enabled} onClick={event => { event.stopPropagation(); toggleQueueItem(item.id) }}><i /></span></span>
                  </button>
                )
              })}
            </div>
            <footer><p>{mode === 'auto' ? '请求失败时按队列顺序自动尝试下一个可用模型。' : '手动指定仅影响新请求，正在进行的请求不会中断。'}</p><button type="button">管理上游模型 <ChevronRight size={12} /></button></footer>
          </section>

          <section className="lp-failover-panel">
            <header><div><h2>近期请求与故障切换</h2><p>查看每次请求实际经过的供应商和最终结果。</p></div><button type="button" onClick={() => setActiveView('requests')}>查看全部请求 <ChevronRight size={12} /></button></header>
            <div className="lp-request-list">
              {recentRequests.map(request => <div className="lp-request-row" key={request.id}>
                <code>{request.time}</code><span className="lp-request-protocol">{request.protocol}</span><span className="lp-route-path">{request.route.map((provider, index) => <span key={provider}><strong className={index < request.route.length - 1 ? 'is-failed' : ''}>{provider}</strong>{index < request.route.length - 1 && <ChevronRight size={11} />}</span>)}</span><span className={request.attempts > 1 ? 'lp-switched' : 'lp-succeeded'}>{request.result} · {request.attempts} 次尝试</span><code>{request.duration}</code>
              </div>)}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export { LinearPrototypePage }
