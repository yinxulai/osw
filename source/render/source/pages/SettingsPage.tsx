import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('proxy')

  const tabs = [
    { id: 'proxy', label: '代理设置' },
    { id: 'health', label: '健康检查' },
    { id: 'logs', label: '日志配置' },
    { id: 'about', label: '关于' },
  ]

  return (
    <div>
      <div className="page-header">
        <h2>设置</h2>
        <p>配置代理服务和系统参数</p>
      </div>

      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 代理设置 */}
      {activeTab === 'proxy' && (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">监听配置</div>
                <div className="card-desc">本地代理服务的监听地址和端口</div>
              </div>
              <span className="badge badge-success">运行中</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">监听地址</label>
                <input className="form-input" defaultValue="127.0.0.1" />
                <div className="form-hint">建议使用 127.0.0.1 仅本地访问</div>
              </div>
              <div className="form-group">
                <label className="form-label">监听端口</label>
                <input className="form-input" type="number" defaultValue={3000} />
                <div className="form-hint">修改后需要重启服务</div>
              </div>
            </div>
            <div className="form-group">
              <div className="switch on" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                开机自启动
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">默认超时设置</div>
                <div className="card-desc">全局默认超时时间，可在 Provider 级别覆盖</div>
              </div>
            </div>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">连接超时</label>
                <input className="form-input" type="number" defaultValue={10000} />
                <div className="form-hint">建立连接超时（毫秒）</div>
              </div>
              <div className="form-group">
                <label className="form-label">空闲超时</label>
                <input className="form-input" type="number" defaultValue={30000} />
                <div className="form-hint">服务端无数据返回超时（毫秒）</div>
              </div>
              <div className="form-group">
                <label className="form-label">总超时</label>
                <input className="form-input" type="number" defaultValue={300000} />
                <div className="form-hint">请求总时长上限（毫秒）</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">上游代理</div>
                <div className="card-desc">通过代理访问上游 API（可选）</div>
              </div>
            </div>
            <div className="form-group">
              <div className="switch" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                启用上游代理
              </span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">代理地址</label>
                <input className="form-input" placeholder="http://127.0.0.1:7890" disabled />
              </div>
              <div className="form-group">
                <label className="form-label">代理类型</label>
                <select className="form-select" disabled>
                  <option>HTTP</option>
                  <option>SOCKS5</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary">保存设置</button>
          </div>
        </>
      )}

      {/* 健康检查 */}
      {activeTab === 'health' && (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">健康检查策略</div>
                <div className="card-desc">控制 Provider 故障检测和冷却行为</div>
              </div>
            </div>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">连续失败阈值</label>
                <input className="form-input" type="number" defaultValue={3} />
                <div className="form-hint">达到此次数进入冷却</div>
              </div>
              <div className="form-group">
                <label className="form-label">初始冷却时间</label>
                <input className="form-input" type="number" defaultValue={30} />
                <div className="form-hint">秒</div>
              </div>
              <div className="form-group">
                <label className="form-label">最大冷却时间</label>
                <input className="form-input" type="number" defaultValue={300} />
                <div className="form-hint">秒，指数退避上限</div>
              </div>
            </div>
            <div className="form-group">
              <div className="switch on" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                成功一次后重置失败计数
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">主动探测</div>
                <div className="card-desc">定期发送探测请求检查 Provider 可用性</div>
              </div>
            </div>
            <div className="form-group">
              <div className="switch" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                启用主动探测
              </span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">探测间隔</label>
                <input className="form-input" type="number" defaultValue={60} disabled />
                <div className="form-hint">秒</div>
              </div>
              <div className="form-group">
                <label className="form-label">探测模型</label>
                <input className="form-input" placeholder="使用各绑定的模型" disabled />
                <div className="form-hint">留空使用绑定的模型</div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary">保存设置</button>
          </div>
        </>
      )}

      {/* 日志配置 */}
      {activeTab === 'logs' && (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">请求日志</div>
                <div className="card-desc">记录所有经过代理的请求</div>
              </div>
            </div>
            <div className="form-group">
              <div className="switch on" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                启用请求日志
              </span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">日志保留天数</label>
                <input className="form-input" type="number" defaultValue={30} />
                <div className="form-hint">超过自动清理</div>
              </div>
              <div className="form-group">
                <label className="form-label">日志级别</label>
                <select className="form-select">
                  <option>全部</option>
                  <option>仅失败</option>
                  <option>关闭</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <div className="switch" style={{ display: 'inline-block' }}></div>
              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
                记录请求和响应内容
              </span>
              <div className="form-hint" style={{ marginTop: 4 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={13} /> 开启后会存储完整的请求和响应体，可能包含敏感信息</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">数据管理</div>
                <div className="card-desc">数据库和日志文件管理</div>
              </div>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <div className="info-label">数据库大小</div>
                <div className="info-value">12.4 MB</div>
              </div>
              <div className="info-item">
                <div className="info-label">日志记录数</div>
                <div className="info-value">28,456 条</div>
              </div>
              <div className="info-item">
                <div className="info-label">数据目录</div>
                <div className="info-value">
                  <code style={{ fontSize: 12 }}>~/Library/Application Support/one-switch</code>
                </div>
              </div>
            </div>
            <div className="flex gap-2" style={{ marginTop: 12 }}>
              <button className="btn">打开数据目录</button>
              <button className="btn">导出日志</button>
              <button className="btn btn-danger">清空日志</button>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary">保存设置</button>
          </div>
        </>
      )}

      {/* 关于 */}
      {activeTab === 'about' && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🔀</div>
          <div className="card-title" style={{ fontSize: 24, marginBottom: 4 }}>
            One Switch
          </div>
          <div className="text-muted" style={{ marginBottom: 24 }}>
            本地大模型代理自动切换工具
          </div>
          <div className="info-grid" style={{ maxWidth: 400, margin: '0 auto 24px' }}>
            <div className="info-item">
              <div className="info-label">版本</div>
              <div className="info-value">v0.1.0</div>
            </div>
            <div className="info-item">
              <div className="info-label">构建</div>
              <div className="info-value">2024.02.15</div>
            </div>
          </div>
          <div className="flex gap-2" style={{ justifyContent: 'center' }}>
            <button className="btn">检查更新</button>
            <button className="btn">GitHub</button>
            <button className="btn">反馈问题</button>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 24 }}>
            不做协议转换 · 永远只有一个队列 · 故障自动切换
          </div>
        </div>
      )}
    </div>
  )
}
