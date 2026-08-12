import { useState } from 'react'
import { Pencil, Plug, Trash2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function ModelsPage() {
  const [selectedModel, setSelectedModel] = useState('model_001')
  const [showBindingModal, setShowBindingModal] = useState(false)
  const [showModelModal, setShowModelModal] = useState(false)

  const models = [
    {
      id: 'model_001',
      name: '默认模型',
      description: '通用对话场景，自动选择最优 Provider',
      bindingCount: 5,
      enabled: true,
      createdTime: '2024-01-15',
    },
    {
      id: 'model_002',
      name: '代码模型',
      description: '代码生成和补全专用',
      bindingCount: 3,
      enabled: true,
      createdTime: '2024-01-20',
    },
    {
      id: 'model_003',
      name: '图像模型',
      description: '多模态视觉理解',
      bindingCount: 2,
      enabled: false,
      createdTime: '2024-02-01',
    },
  ]

  const bindings = [
    {
      id: 'bind_001',
      provider: 'OpenAI',
      upstreamModelId: 'gpt-4o',
      protocol: 'OpenAI',
      upstreamUrl: 'https://api.openai.com/v1',
      customAuthHeader: '',
      priority: 1,
      enabled: true,
      status: 'active',
    },
    {
      id: 'bind_002',
      provider: 'Anthropic',
      upstreamModelId: 'claude-3-5-sonnet-20240620',
      protocol: 'OpenAI',
      upstreamUrl: 'https://api.anthropic.com/v1',
      customAuthHeader: 'x-api-key',
      priority: 2,
      enabled: true,
      status: 'standby',
    },
    {
      id: 'bind_003',
      provider: 'DeepSeek',
      upstreamModelId: 'deepseek-chat',
      protocol: 'OpenAI',
      upstreamUrl: 'https://api.deepseek.com/v1',
      customAuthHeader: '',
      priority: 3,
      enabled: true,
      status: 'warning',
    },
    {
      id: 'bind_004',
      provider: 'Gemini',
      upstreamModelId: 'gemini-1.5-pro-002',
      protocol: 'OpenAI',
      upstreamUrl: 'https://generativelanguage.googleapis.com/v1beta',
      customAuthHeader: 'x-goog-api-key',
      priority: 4,
      enabled: true,
      status: 'cooling',
    },
    {
      id: 'bind_005',
      provider: 'Ollama (本地)',
      upstreamModelId: 'qwen2.5:72b',
      protocol: 'OpenAI',
      upstreamUrl: 'http://localhost:11434/v1',
      customAuthHeader: '',
      priority: 5,
      enabled: true,
      status: 'standby',
    },
  ]

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-info">当前</span>
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

  const currentModel = models.find(m => m.id === selectedModel)

  return (
    <div>
      <div className="page-header">
        <h2>模型管理</h2>
        <p>管理逻辑模型及其上游绑定关系</p>
      </div>

      <div className="two-col-layout">
        {/* 左侧：模型列表 */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <div className="flex justify-between items-center">
              <div className="text-bold">逻辑模型</div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowModelModal(true)}>
                + 新建
              </button>
            </div>
          </div>
          <div style={{ padding: 8 }}>
            {models.map(m => (
              <div
                key={m.id}
                className={`model-item ${selectedModel === m.id ? 'active' : ''}`}
                onClick={() => setSelectedModel(m.id)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-bold">{m.name}</div>
                    <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                      {m.description}
                    </div>
                  </div>
                  {!m.enabled && <span className="badge badge-muted">已禁用</span>}
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                  {m.bindingCount} 个绑定
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：绑定详情 */}
        <div>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">{currentModel?.name} · 绑定列表</div>
                <div className="card-desc">{currentModel?.description}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm">编辑模型</button>
                <button className="btn btn-sm btn-primary" onClick={() => setShowBindingModal(true)}>
                  + 添加模型
                </button>
              </div>
            </div>
          </div>

          {/* 绑定优先级列表 */}
          <div className="card" style={{ padding: 0 }}>
            <div className="priority-list">
              {bindings.map((b, idx) => (
                <div
                  key={b.id}
                  className={`priority-item ${b.status === 'cooling' ? 'cooling' : ''}`}
                >
                  <span className="priority-drag">⋮⋮</span>
                  <div className="priority-number">{idx + 1}</div>
                  <div className="priority-info">
                    <div className="priority-name">
                      {b.provider}
                      <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>
                        → {b.upstreamModelId}
                      </span>
                    </div>
                    <div className="priority-meta">
                      <span>协议: {b.protocol}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {b.upstreamUrl}
                      </span>
                      {b.customAuthHeader && (
                        <span>自定义头: {b.customAuthHeader}</span>
                      )}
                    </div>
                  </div>
                  {statusBadge(b.status)}
                  <div className="priority-actions">
                    <button className="btn btn-sm btn-ghost" title="编辑"><Pencil size={14} /></button>
                    <button className="btn btn-sm btn-ghost" title="测试"><Plug size={14} /></button>
                    <button className="btn btn-sm btn-danger" title="删除"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            {bindings.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">🔗</div>
                <div className="empty-state-title">暂无绑定</div>
                <div className="empty-state-desc">添加上游绑定以启用自动切换</div>
                <button className="btn btn-primary" onClick={() => setShowBindingModal(true)}>
                  添加第一个模型
                </button>
              </div>
            )}
          </div>

          {/* 模型信息 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">模型信息</div>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <div className="info-label">模型 ID</div>
                <div className="info-value"><code>{currentModel?.id}</code></div>
              </div>
              <div className="info-item">
                <div className="info-label">创建时间</div>
                <div className="info-value">{currentModel?.createdTime}</div>
              </div>
              <div className="info-item">
                <div className="info-label">绑定数量</div>
                <div className="info-value">{currentModel?.bindingCount} 个</div>
              </div>
              <div className="info-item">
                <div className="info-label">状态</div>
                <div className="info-value">
                  {currentModel?.enabled ? (
                    <span className="badge badge-success">已启用</span>
                  ) : (
                    <span className="badge badge-muted">已禁用</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 添加模型弹窗 */}
      {showBindingModal && (
        <div className="modal-overlay" onClick={() => setShowBindingModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">添加模型</div>
              <button className="modal-close" onClick={() => setShowBindingModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Provider <span className="required">*</span>
                </label>
                <Select>
                  <SelectTrigger className="form-select">
                    <SelectValue placeholder="选择 Provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="ollama">Ollama (本地)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    协议 <span className="required">*</span>
                  </label>
                  <Select defaultValue="openai">
                    <SelectTrigger className="form-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI 兼容</SelectItem>
                      <SelectItem value="anthropic">Anthropic 原生</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="form-group">
                  <label className="form-label">优先级</label>
                  <input className="form-input" type="number" defaultValue={1} />
                  <div className="form-hint">数字越小优先级越高</div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  上游地址 <span className="required">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="https://api.openai.com/v1"
                />
                <div className="form-hint">API 基础地址，不含模型路径</div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  上游模型 ID <span className="required">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="gpt-4o / claude-3-5-sonnet / ..."
                />
                <div className="form-hint">上游服务中的实际模型名称</div>
              </div>

              <div className="form-group">
                <label className="form-label">自定义认证头</label>
                <input
                  className="form-input"
                  placeholder="留空使用默认 Authorization"
                />
                <div className="form-hint">
                  某些服务商使用不同的认证头名称，如 Anthropic 使用 x-api-key
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowBindingModal(false)}>
                取消
              </button>
              <button className="btn btn-primary">添加模型</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建模型弹窗 */}
      {showModelModal && (
        <div className="modal-overlay" onClick={() => setShowModelModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建逻辑模型</div>
              <button className="modal-close" onClick={() => setShowModelModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  模型名称 <span className="required">*</span>
                </label>
                <input className="form-input" placeholder="例如：默认模型、代码模型" />
              </div>
              <div className="form-group">
                <label className="form-label">描述</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="简要描述这个模型的用途"
                />
              </div>
              <div className="form-group">
                <div className="switch on" style={{ display: 'inline-block' }}></div>
                <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                  立即可用
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModelModal(false)}>
                取消
              </button>
              <button className="btn btn-primary">创建模型</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
