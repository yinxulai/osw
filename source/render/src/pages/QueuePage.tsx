import { useEffect, useState } from 'react'
import { queueApi, bindingApi, logicalModelApi, providerApi } from '../api'
import type { ModelBinding, LogicalModel, Provider } from '@common/schemas'

export default function QueuePage() {
  const [models, setModels] = useState<LogicalModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [bindings, setBindings] = useState<ModelBinding[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [manualBindingId, setManualBindingId] = useState<string | null>(null)

  const loadData = async () => {
    const [modelsRes, providersRes, queueRes] = await Promise.all([
      logicalModelApi.list(),
      providerApi.list(),
      queueApi.status(),
    ])
    if (modelsRes.success) {
      setModels(modelsRes.data)
      if (modelsRes.data.length > 0 && !selectedModelId) {
        setSelectedModelId(modelsRes.data[0].id)
      }
    }
    if (providersRes.success) setProviders(providersRes.data)
    if (queueRes.success) setManualBindingId(queueRes.data.manualBindingId)
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedModelId) {
      bindingApi.list(selectedModelId).then(res => {
        if (res.success) setBindings(res.data)
      })
    }
  }, [selectedModelId])

  const handleSwitch = async (bindingId: string | null) => {
    const res = await queueApi.switch(bindingId)
    if (res.success) {
      setManualBindingId(res.data.bindingId)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>自动切换队列</h2>
        <p>查看和管理请求队列，支持手动切换</p>
      </div>

      <div className="card">
        <h3>选择逻辑模型</h3>
        <div style={{ marginBottom: 12 }}>
          <select
            className="btn"
            value={selectedModelId ?? ''}
            onChange={e => setSelectedModelId(e.target.value || null)}
            style={{ minWidth: 300 }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h3>手动切换</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          手动指定使用某个上游模型。切换后新请求将走新模型，当前进行中的请求不受影响。
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="btn"
            value={manualBindingId ?? ''}
            onChange={e => handleSwitch(e.target.value || null)}
            style={{ minWidth: 300 }}
          >
            <option value="">-- 自动切换（按优先级）--</option>
            {bindings.map(b => {
              const provider = providers.find(p => p.id === b.providerId)
              return (
                <option key={b.id} value={b.id}>
                  {provider?.name} / {b.upstreamModelId} (优先级: {b.priority})
                </option>
              )
            })}
          </select>
          {manualBindingId && (
            <button className="btn" onClick={() => handleSwitch(null)}>
              恢复自动
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>队列优先级</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          请求按优先级从高到低尝试，失败自动切换到下一个可用 Provider。
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>优先级</th>
              <th>Provider</th>
              <th>协议</th>
              <th>上游模型</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b, idx) => {
              const provider = providers.find(p => p.id === b.providerId)
              const isManual = manualBindingId === b.id
              return (
                <tr key={b.id} style={{ background: isManual ? '#e6f4ff' : undefined }}>
                  <td>{idx + 1}</td>
                  <td>{provider?.name ?? '-'}</td>
                  <td><span className="tag tag-default">{b.protocol}</span></td>
                  <td>{b.upstreamModelId}</td>
                  <td>
                    {isManual ? (
                      <span className="tag tag-success">当前使用</span>
                    ) : b.enabled ? (
                      <span className="tag tag-default">待命</span>
                    ) : (
                      <span className="tag tag-error">禁用</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {bindings.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  暂无绑定，请先在模型管理中添加
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
