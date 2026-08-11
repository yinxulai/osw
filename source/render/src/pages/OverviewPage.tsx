import { useEffect, useState } from 'react'
import { providerApi, logicalModelApi, healthApi, queueApi } from '../api'
import type { Provider, LogicalModel, ProviderHealth } from '@common/schemas'

export default function OverviewPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<LogicalModel[]>([])
  const [healthList, setHealthList] = useState<ProviderHealth[]>([])
  const [manualBindingId, setManualBindingId] = useState<string | null>(null)

  useEffect(() => {
    providerApi.list().then(res => {
      if (res.success) setProviders(res.data)
    })
    logicalModelApi.list().then(res => {
      if (res.success) setModels(res.data)
    })
    healthApi.list().then(res => {
      if (res.success) setHealthList(res.data)
    })
    queueApi.status().then(res => {
      if (res.success) setManualBindingId(res.data.manualBindingId)
    })
  }, [])

  const activeProviders = providers.filter(p => p.enabled).length
  const healthyCount = healthList.filter(h => !h.cooldownUntilTime || h.cooldownUntilTime <= Date.now()).length

  return (
    <div>
      <div className="page-header">
        <h2>概览</h2>
        <p>服务运行状态总览</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Provider 总数</div>
          <div className="stat-value">{providers.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">启用中</div>
          <div className="stat-value">{activeProviders}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">健康可用</div>
          <div className="stat-value">{healthyCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">逻辑模型</div>
          <div className="stat-value">{models.length}</div>
        </div>
      </div>

      <div className="card">
        <h3>手动切换状态</h3>
        <p style={{ fontSize: 13, color: '#666' }}>
          {manualBindingId ? (
            <>当前手动指定 Binding: <code>{manualBindingId}</code></>
          ) : (
            '当前为自动切换模式'
          )}
        </p>
      </div>

      <div className="card">
        <h3>Provider 健康状态</h3>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>状态</th>
              <th>连续失败</th>
              <th>最近成功</th>
              <th>最近失败</th>
            </tr>
          </thead>
          <tbody>
            {healthList.map(h => {
              const provider = providers.find(p => p.id === h.providerId)
              const isCooling = h.cooldownUntilTime && h.cooldownUntilTime > Date.now()
              return (
                <tr key={h.providerId}>
                  <td>{provider?.name ?? h.providerId}</td>
                  <td>
                    {isCooling ? (
                      <span className="tag tag-warning">冷却中</span>
                    ) : h.consecutiveFailures > 0 ? (
                      <span className="tag tag-error">异常</span>
                    ) : (
                      <span className="tag tag-success">正常</span>
                    )}
                  </td>
                  <td>{h.consecutiveFailures}</td>
                  <td>{h.lastSuccessTime ? new Date(h.lastSuccessTime).toLocaleString() : '-'}</td>
                  <td>{h.lastFailureTime ? new Date(h.lastFailureTime).toLocaleString() : '-'}</td>
                </tr>
              )
            })}
            {healthList.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
