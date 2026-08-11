import { useState, useRef, useEffect } from 'react'
import {
  Target,
  BarChart3,
  CheckCircle2,
  Plug,
  RefreshCw,
  Lightbulb,
  Pencil,
  AlertTriangle,
  Plus,
  Activity,
  Copy,
  Server,
  KeyRound,
  GripVertical,
  ChevronUp,
  ChevronDown,
  CircleDot,
  Circle,
  ChevronDown as ChevronDownIcon,
} from 'lucide-react'

type Protocol = 'openai' | 'anthropic' | 'gemini'

const PROTOCOLS: { key: Protocol; label: string; path: string }[] = [
  { key: 'openai', label: 'OpenAI', path: '/v1' },
  { key: 'anthropic', label: 'Anthropic', path: '/v1/anthropic' },
  { key: 'gemini', label: 'Gemini', path: '/v1/gemini' },
]

export default function QueuePage() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [manualBinding, setManualBinding] = useState('')
  const [copied, setCopied] = useState(false)
  const [protocol, setProtocol] = useState<Protocol>('openai')
  const [protocolDropdown, setProtocolDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 逻辑模型名（队列标识）
  const queueModelName = 'default'
  const isDefaultQueue = queueModelName === 'default'

  const bindings = [
    {
      id: 'bind_001',
      provider: 'OpenAI',
      model: 'gpt-4o',
      protocol: 'OpenAI',
      upstream: 'https://api.openai.com/v1',
      priority: 1,
      status: 'active',
      latency: '1.2s',
      successRate: '99.8%',
    },
    {
      id: 'bind_002',
      provider: 'Anthropic',
      model: 'claude-3-5-sonnet-20240620',
      protocol: 'OpenAI',
      upstream: 'https://api.anthropic.com/v1',
      priority: 2,
      status: 'standby',
      latency: '2.1s',
      successRate: '99.5%',
    },
    {
      id: 'bind_003',
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      protocol: 'OpenAI',
      upstream: 'https://api.deepseek.com/v1',
      priority: 3,
      status: 'warning',
      latency: '5.8s',
      successRate: '97.2%',
    },
    {
      id: 'bind_004',
      provider: 'Gemini',
      model: 'gemini-1.5-pro-002',
      protocol: 'OpenAI',
      upstream: 'https://generativelanguage.googleapis.com/v1beta',
      priority: 4,
      status: 'cooling',
      latency: '-',
      successRate: '-',
      cooldownRemain: '2分30秒',
    },
    {
      id: 'bind_005',
      provider: 'Ollama (本地)',
      model: 'qwen2.5:72b',
      protocol: 'OpenAI',
      upstream: 'http://localhost:11434/v1',
      priority: 5,
      status: 'standby',
      latency: '3.5s',
      successRate: '99.9%',
    },
  ]

  // 每个协议下可用的模型数量（mock 数据，实际应根据协议兼容性计算）
  const protocolModelCounts: Record<Protocol, number> = {
    openai: 5,
    anthropic: 3,
    gemini: 2,
  }

  const currentProtocol = PROTOCOLS.find(p => p.key === protocol)!
  const availableCount = protocolModelCounts[protocol]
  const proxyBase = 'http://127.0.0.1:9300'
  const fullProxyUrl = `${proxyBase}${currentProtocol.path}`

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProtocolDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-info">当前使用</span>
      case 'standby':
        return <span className="badge badge-success">待命</span>
      case 'warning':
        return <span className="badge badge-warning">延迟高</span>
      case 'cooling':
        return <span className="badge badge-error">冷却中</span>
      case 'disabled':
        return <span className="badge badge-muted">已禁用</span>
      default:
        return <span className="badge badge-muted">未知</span>
    }
  }

  const copyEndpoint = () => {
    if (availableCount <= 0) return
    navigator.clipboard.writeText(fullProxyUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyModelName = () => {
    navigator.clipboard.writeText(queueModelName)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSwitchToManual = () => {
    const active = bindings.find(b => b.status === 'active')
    if (active) {
      setManualBinding(active.id)
    }
    setMode('manual')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>模型队列</h2>
          <p>管理请求优先级和故障转移策略</p>
        </div>
      </div>

      {/* 服务接入配置 */}
      <div className="card endpoint-card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <Server size={18} style={{ marginRight: 8, verticalAlign: '-3px', color: 'var(--primary)' }} />
              服务接入配置
            </div>
            <div className="card-desc">将你的应用请求地址指向下方代理地址即可使用</div>
          </div>
          <span className="badge badge-success" style={{ gap: 6, display: 'inline-flex' }}>
            <span className="status-dot" style={{ width: 6, height: 6, marginRight: 0 }}></span>
            运行中
          </span>
        </div>

        <div className="endpoint-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="endpoint-item">
            <div className="endpoint-label">
              <Plug size={14} />
              代理地址
            </div>
            <div className="endpoint-value-row">
              <div className={`endpoint-input-group ${availableCount <= 0 ? 'disabled' : ''}`}>
                <code className="endpoint-value">{fullProxyUrl}</code>
                <div className="protocol-select" ref={dropdownRef}>
                  <button
                    className="protocol-select-btn"
                    onClick={() => setProtocolDropdown(!protocolDropdown)}
                  >
                    {currentProtocol.label}
                    <ChevronDownIcon size={13} style={{ opacity: 0.6 }} />
                  </button>
                  {protocolDropdown && (
                    <div className="protocol-dropdown">
                      {PROTOCOLS.map(p => {
                        const count = protocolModelCounts[p.key]
                        const disabled = count <= 0
                        return (
                          <div
                            key={p.key}
                            className={`protocol-dropdown-item ${protocol === p.key ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                            onClick={() => {
                              if (!disabled) {
                                setProtocol(p.key)
                                setProtocolDropdown(false)
                              }
                            }}
                          >
                            <span>{p.label}</span>
                            <span className="protocol-count">
                              {count} 个模型可用
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              <button
                className={`btn btn-sm ${availableCount <= 0 ? 'btn-ghost disabled' : 'btn-ghost'}`}
                onClick={copyEndpoint}
                disabled={availableCount <= 0}
              >
                <Copy size={14} />
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="endpoint-item">
            <div className="endpoint-label">
              <KeyRound size={14} />
              API Key
            </div>
            <div className="endpoint-value-row">
              <code className="endpoint-value">无需配置，本地服务</code>
              <span className="badge badge-success">免认证</span>
            </div>
          </div>
        </div>

        <div className="endpoint-hint">
          <Lightbulb size={14} />
          <span>
            使用方式：将客户端的 <code>baseURL</code> 设置为上方代理地址，
            模型名称填写下方队列的逻辑模型名即可。
            所有请求会自动按优先级队列进行故障转移。
          </span>
        </div>
      </div>

      {/* 快速状态卡片 */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">
            <BarChart3 size={16} />
            今日请求
          </div>
          <div className="stat-value">1,284</div>
          <div className="stat-trend up">
            +12.5% 较昨日
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <CheckCircle2 size={16} />
            成功率
          </div>
          <div className="stat-value">99.2%</div>
          <div className="stat-trend up">
            +0.3% 较昨日
          </div>
        </div>
      </div>

      {/* 优先级队列 */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                优先级队列
                <span className="queue-model-name">
                  {isDefaultQueue ? (
                    <span className="queue-model-default">默认队列 · 任意模型</span>
                  ) : (
                    <>
                      <code className="queue-model-code">{queueModelName}</code>
                      <button className="queue-model-copy" onClick={copyModelName} title="复制模型名">
                        <Copy size={12} />
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="card-desc">拖拽调整优先级顺序，数字越小优先级越高</div>
            </div>
          </div>
          <div className="flex gap-2">
            {/* 模式切换按钮组 */}
            <div className="mode-toggle">
              <button
                className={`mode-toggle-btn ${mode === 'auto' ? 'active' : ''}`}
                onClick={() => setMode('auto')}
              >
                <RefreshCw size={14} />
                自动转移
              </button>
              <button
                className={`mode-toggle-btn ${mode === 'manual' ? 'active' : ''}`}
                onClick={handleSwitchToManual}
              >
                <Target size={14} />
                手动指定
              </button>
            </div>
            <button className="btn btn-sm"><Plus size={14} /> 添加绑定</button>
            <button className="btn btn-sm btn-primary"><Activity size={14} /> 测试全部</button>
          </div>
        </div>

        <div className="priority-list">
          {bindings.map((b, idx) => (
            <div
              key={b.id}
              className={`priority-item ${b.status === 'active' ? 'active' : ''} ${mode === 'manual' && manualBinding === b.id ? 'current' : ''} ${b.status === 'cooling' ? 'cooling' : ''} ${mode === 'manual' ? 'selectable' : ''}`}
              onClick={() => {
                if (mode === 'manual' && b.status !== 'cooling') {
                  setManualBinding(manualBinding === b.id ? '' : b.id)
                }
              }}
            >
              {mode === 'manual' && (
                <span className="priority-select">
                  {manualBinding === b.id ? (
                    <CircleDot size={18} style={{ color: '#2563eb' }} />
                  ) : (
                    <Circle size={18} style={{ color: '#d1d5db' }} />
                  )}
                </span>
              )}
              {mode !== 'manual' && (
                <span className="priority-drag"><GripVertical size={14} /></span>
              )}
              <div className="priority-number">{idx + 1}</div>
              <div className="priority-info">
                <div className="priority-name">
                  {b.provider}
                  <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>
                    {b.model}
                  </span>
                </div>
                <div className="priority-meta">
                  <span>协议: {b.protocol}</span>
                  <span>延迟: {b.latency}</span>
                  <span>成功率: {b.successRate}</span>
                  {b.status === 'cooling' && b.cooldownRemain && (
                    <span style={{ color: '#dc2626' }}>冷却剩余: {b.cooldownRemain}</span>
                  )}
                </div>
              </div>
              {statusBadge(b.status)}
              <div className="priority-actions">
                <button className="btn btn-sm btn-ghost" title="上移"><ChevronUp size={14} /></button>
                <button className="btn btn-sm btn-ghost" title="下移"><ChevronDown size={14} /></button>
                <button className="btn btn-sm btn-ghost" title="编辑"><Pencil size={14} /></button>
                <button className="btn btn-sm btn-ghost" title="测试连接"><Plug size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 切换策略设置 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">转移策略</div>
        </div>
        <div className="form-row-3">
          <div className="form-group">
            <label className="form-label">连续失败阈值</label>
            <input className="form-input" defaultValue={3} type="number" />
            <div className="form-hint">达到此次数后进入冷却</div>
          </div>
          <div className="form-group">
            <label className="form-label">冷却基础时间</label>
            <input className="form-input" defaultValue={30} type="number" />
            <div className="form-hint">初始冷却时间（秒）</div>
          </div>
          <div className="form-group">
            <label className="form-label">冷却最大时间</label>
            <input className="form-input" defaultValue={300} type="number" />
            <div className="form-hint">冷却时间上限（秒）</div>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">空闲超时</label>
            <input className="form-input" defaultValue={30000} type="number" />
            <div className="form-hint">服务端连续无数据返回的超时时间（毫秒）</div>
          </div>
          <div className="form-group">
            <label className="form-label">连接超时</label>
            <input className="form-input" defaultValue={10000} type="number" />
            <div className="form-hint">建立连接的超时时间（毫秒）</div>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> 修改转移策略会立即生效，当前进行中的请求不受影响</span>
          </div>
          <button className="btn btn-primary">保存设置</button>
        </div>
      </div>
    </div>
  )
}
