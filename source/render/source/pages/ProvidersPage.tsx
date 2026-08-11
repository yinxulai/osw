import { useState } from 'react'
import {
  Plug,
  Key,
  Lightbulb,
  Search,
  Plus,
  Pencil,
  Trash2,
  Activity,
  Server,
  Clock,
  Link2,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

export default function ProvidersPage() {
  const [selectedId, setSelectedId] = useState('prov_001')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const providers = [
    {
      id: 'prov_001',
      name: 'OpenAI',
      apiKeyRef: 'key_openai_abc123',
      baseUrl: 'https://api.openai.com/v1',
      timeout: 30000,
      enabled: true,
      status: 'healthy',
      latency: '1.2s',
      createdTime: '2024-01-15 10:30',
    },
    {
      id: 'prov_002',
      name: 'Anthropic',
      apiKeyRef: 'key_anthropic_def456',
      baseUrl: 'https://api.anthropic.com/v1',
      timeout: 30000,
      enabled: true,
      status: 'healthy',
      latency: '2.1s',
      createdTime: '2024-01-16 14:20',
    },
    {
      id: 'prov_003',
      name: 'DeepSeek',
      apiKeyRef: 'key_deepseek_ghi789',
      baseUrl: 'https://api.deepseek.com/v1',
      timeout: 60000,
      enabled: true,
      status: 'warning',
      latency: '5.8s',
      createdTime: '2024-01-18 09:15',
    },
    {
      id: 'prov_004',
      name: 'Gemini',
      apiKeyRef: 'key_gemini_jkl012',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      timeout: 30000,
      enabled: true,
      status: 'cooling',
      latency: '-',
      createdTime: '2024-01-20 16:45',
    },
    {
      id: 'prov_005',
      name: 'Ollama (本地)',
      apiKeyRef: '',
      baseUrl: 'http://localhost:11434/v1',
      timeout: 120000,
      enabled: true,
      status: 'healthy',
      latency: '3.5s',
      createdTime: '2024-01-22 08:00',
    },
  ]

  // 每个供应商的模型列表
  const providerModels: Record<string, Array<{
    id: string
    name: string
    upstreamModel: string
    protocol: string
    priority: number
    status: string
    latency: string
    successRate: string
  }>> = {
    'prov_001': [
      { id: 'm_001', name: '默认模型', upstreamModel: 'gpt-4o', protocol: 'OpenAI', priority: 1, status: 'active', latency: '1.2s', successRate: '99.8%' },
      { id: 'm_002', name: '代码模型', upstreamModel: 'gpt-4o', protocol: 'OpenAI', priority: 2, status: 'standby', latency: '1.2s', successRate: '99.8%' },
      { id: 'm_003', name: '快速模型', upstreamModel: 'gpt-4o-mini', protocol: 'OpenAI', priority: 3, status: 'standby', latency: '0.6s', successRate: '99.9%' },
    ],
    'prov_002': [
      { id: 'm_004', name: '默认模型', upstreamModel: 'claude-3-5-sonnet-20240620', protocol: 'OpenAI', priority: 2, status: 'standby', latency: '2.1s', successRate: '99.5%' },
      { id: 'm_005', name: '长文本模型', upstreamModel: 'claude-3-opus-20240229', protocol: 'OpenAI', priority: 5, status: 'standby', latency: '3.8s', successRate: '99.0%' },
    ],
    'prov_003': [
      { id: 'm_006', name: '默认模型', upstreamModel: 'deepseek-chat', protocol: 'OpenAI', priority: 3, status: 'warning', latency: '5.8s', successRate: '97.2%' },
    ],
    'prov_004': [
      { id: 'm_007', name: '图像模型', upstreamModel: 'gemini-1.5-pro-002', protocol: 'OpenAI', priority: 4, status: 'cooling', latency: '-', successRate: '-' },
    ],
    'prov_005': [
      { id: 'm_008', name: '本地模型', upstreamModel: 'qwen2.5:72b', protocol: 'OpenAI', priority: 5, status: 'standby', latency: '3.5s', successRate: '99.9%' },
    ],
  }

  const filtered = providers.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selected = providers.find(p => p.id === selectedId)
  const models = providerModels[selectedId] || []

  const statusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'active':
      case 'standby':
        return <span className="badge badge-success">正常</span>
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

  const modelStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-info">当前使用</span>
      case 'standby':
        return <span className="badge badge-success">待命</span>
      case 'warning':
        return <span className="badge badge-warning">延迟高</span>
      case 'cooling':
        return <span className="badge badge-error">冷却中</span>
      default:
        return <span className="badge badge-muted">未知</span>
    }
  }

  const handleEdit = (id: string) => {
    setEditingId(id)
    setShowModal(true)
  }

  const handleNew = () => {
    setEditingId(null)
    setShowModal(true)
  }

  return (
    <div className="two-col-layout">
      {/* 左侧：供应商列表 */}
      <div className="left-panel">
        <div className="panel-header">
          <h3>供应商</h3>
          <button className="btn btn-sm btn-primary" onClick={handleNew}>
            <Plus size={14} /> 新建
          </button>
        </div>

        <div className="search-box">
          <Search size={15} />
          <input
            type="text"
            placeholder="搜索供应商..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="provider-list">
          {filtered.map(p => (
            <div
              key={p.id}
              className={`provider-item ${selectedId === p.id ? 'active' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <div className="provider-item-icon">
                <Plug size={16} />
              </div>
              <div className="provider-item-info">
                <div className="provider-item-name">{p.name}</div>
                <div className="provider-item-meta">
                  {modelsOf(p.id)} 个模型 · {p.latency}
                </div>
              </div>
              <div className={`provider-status-dot status-${p.status}`}></div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="empty-state">
            <Plug size={32} />
            <p>没有找到匹配的供应商</p>
          </div>
        )}
      </div>

      {/* 右侧：供应商详情 + 模型列表 */}
      <div className="right-panel">
        {selected ? (
          <>
            {/* 供应商信息卡片 */}
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">
                    <Server size={18} style={{ marginRight: 8, verticalAlign: '-3px', color: 'var(--primary)' }} />
                    {selected.name}
                  </div>
                  <div className="card-desc">供应商配置信息</div>
                </div>
                <div className="flex gap-2">
                  {statusBadge(selected.status)}
                  <button className="btn btn-sm btn-ghost" title="测试连接">
                    <Activity size={14} /> 测试
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleEdit(selected.id)}>
                    <Pencil size={14} /> 编辑
                  </button>
                </div>
              </div>

              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label"><Plug size={14} /> 基础地址</div>
                  <div className="info-value code">{selected.baseUrl}</div>
                </div>
                <div className="info-item">
                  <div className="info-label"><Key size={14} /> API Key</div>
                  <div className="info-value">
                    {selected.apiKeyRef ? (
                      <span>已配置 · 钥匙串存储</span>
                    ) : (
                      <span className="text-muted">未配置（本地服务）</span>
                    )}
                  </div>
                </div>
                <div className="info-item">
                  <div className="info-label"><Clock size={14} /> 请求超时</div>
                  <div className="info-value">{selected.timeout / 1000} 秒</div>
                </div>
                <div className="info-item">
                  <div className="info-label"><Activity size={14} /> 状态</div>
                  <div className="info-value">
                    {selected.enabled ? '已启用' : '已禁用'} · 延迟 {selected.latency}
                  </div>
                </div>
              </div>
            </div>

            {/* 模型列表 */}
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">
                    <Link2 size={18} style={{ marginRight: 8, verticalAlign: '-3px', color: 'var(--primary)' }} />
                    已配置模型
                  </div>
                  <div className="card-desc">该供应商下的上游模型绑定，共 {models.length} 个</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm">
                    <Plus size={14} /> 添加模型
                  </button>
                </div>
              </div>

              {models.length > 0 ? (
                <div className="model-list">
                  {models.map((m, idx) => (
                    <div key={m.id} className="model-item">
                      <span className="priority-drag"><GripVertical size={14} /></span>
                      <div className="priority-number">{idx + 1}</div>
                      <div className="model-item-info">
                        <div className="model-item-name">
                          {m.name}
                          <span className="model-item-upstream">→ {m.upstreamModel}</span>
                        </div>
                        <div className="model-item-meta">
                          <span>协议: {m.protocol}</span>
                          <span>延迟: {m.latency}</span>
                          <span>成功率: {m.successRate}</span>
                        </div>
                      </div>
                      {modelStatusBadge(m.status)}
                      <div className="model-item-actions">
                        <button className="btn btn-sm btn-ghost" title="上移"><ChevronUp size={14} /></button>
                        <button className="btn btn-sm btn-ghost" title="下移"><ChevronDown size={14} /></button>
                        <button className="btn btn-sm btn-ghost" title="编辑"><Pencil size={14} /></button>
                        <button className="btn btn-sm btn-ghost" title="测试"><Activity size={14} /></button>
                        <button className="btn btn-sm btn-danger" title="删除"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Link2 size={32} />
                  <p>该供应商暂无配置模型</p>
                  <button className="btn btn-sm btn-primary">
                    <Plus size={14} /> 添加第一个模型
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ marginTop: 80 }}>
            <Plug size={48} />
            <p>选择一个供应商查看详情</p>
          </div>
        )}
      </div>

      {/* 新建/编辑供应商弹窗 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑供应商' : '新建供应商'}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">供应商名称</label>
                <input className="form-input" defaultValue={editingId ? 'OpenAI' : ''} placeholder="例如：OpenAI" />
                <div className="form-hint">用于识别和展示的显示名称</div>
              </div>
              <div className="form-group">
                <label className="form-label">基础地址 (Base URL)</label>
                <input className="form-input" defaultValue={editingId ? 'https://api.openai.com/v1' : ''} placeholder="https://api.example.com/v1" />
                <div className="form-hint">API 请求的基础地址</div>
              </div>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <div className="flex gap-2">
                  <input
                    className="form-input"
                    type="password"
                    placeholder="sk-..."
                    defaultValue={editingId ? '••••••••••••' : ''}
                  />
                  <button className="btn">更换</button>
                </div>
                <div className="form-hint">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Key size={13} /> API Key 安全存储在系统钥匙串中，数据库只保存引用 ID</span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">请求超时</label>
                  <input
                    className="form-input"
                    type="number"
                    defaultValue={30000}
                  />
                  <div className="form-hint">毫秒</div>
                </div>
                <div className="form-group">
                  <label className="form-label">启用状态</label>
                  <div style={{ paddingTop: 6 }}>
                    <div className="switch on" style={{ display: 'inline-block' }}></div>
                    <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                      启用此供应商
                    </span>
                  </div>
                </div>
              </div>

              <div className="divider"></div>

              <div style={{ fontSize: 13, color: '#6b7280' }}>
                <div className="text-bold" style={{ color: '#374151', marginBottom: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Lightbulb size={14} /> 提示</span>
                </div>
                供应商只负责连接配置和认证信息。
                你需要在右侧「已配置模型」中添加具体的上游模型，才能在逻辑模型队列中使用。
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={() => setShowModal(false)}>
                {editingId ? '保存修改' : '创建供应商'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function modelsOf(id: string) {
    return providerModels[id]?.length || 0
  }
}
