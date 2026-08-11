import { useEffect, useState } from 'react'
import { logicalModelApi, bindingApi } from '../api'
import type { LogicalModel, ModelBinding } from '@common/schemas'

export default function ModelsPage() {
  const [models, setModels] = useState<LogicalModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [bindings, setBindings] = useState<ModelBinding[]>([])
  const [loading, setLoading] = useState(true)

  const loadModels = async () => {
    setLoading(true)
    const res = await logicalModelApi.list()
    if (res.success && res.data.length > 0) {
      setModels(res.data)
      if (!selectedModelId) {
        setSelectedModelId(res.data[0].id)
      }
    }
    setLoading(false)
  }

  const loadBindings = async (modelId: string) => {
    const res = await bindingApi.list(modelId)
    if (res.success) {
      setBindings(res.data)
    }
  }

  useEffect(() => {
    loadModels()
  }, [])

  useEffect(() => {
    if (selectedModelId) {
      loadBindings(selectedModelId)
    }
  }, [selectedModelId])

  return (
    <div>
      <div className="page-header">
        <h2>模型管理</h2>
        <p>管理逻辑模型和上游绑定</p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ marginBottom: 0 }}>逻辑模型</h3>
          <button className="btn btn-primary">+ 新建模型</button>
        </div>

        {loading ? (
          <p style={{ color: '#999', padding: 24, textAlign: 'center' }}>加载中...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>描述</th>
                <th>状态</th>
                <th>绑定数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr
                  key={m.id}
                  onClick={() => setSelectedModelId(m.id)}
                  style={{ cursor: 'pointer', background: selectedModelId === m.id ? '#e6f4ff' : undefined }}
                >
                  <td>{m.name}</td>
                  <td>{m.description || '-'}</td>
                  <td>
                    {m.enabled ? (
                      <span className="tag tag-success">启用</span>
                    ) : (
                      <span className="tag tag-default">禁用</span>
                    )}
                  </td>
                  <td>-</td>
                  <td>
                    <button className="btn" style={{ marginRight: 8 }}>编辑</button>
                    <button className="btn btn-danger">删除</button>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                    暂无逻辑模型
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selectedModelId && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ marginBottom: 0 }}>
              模型绑定 - {models.find(m => m.id === selectedModelId)?.name}
            </h3>
            <button className="btn btn-primary">+ 添加绑定</button>
          </div>

          <table>
            <thead>
              <tr>
                <th>优先级</th>
                <th>协议</th>
                <th>上游地址</th>
                <th>上游模型</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map(b => (
                <tr key={b.id}>
                  <td>{b.priority}</td>
                  <td><span className="tag tag-default">{b.protocol}</span></td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.upstreamUrl}</td>
                  <td>{b.upstreamModelId}</td>
                  <td>
                    {b.enabled ? (
                      <span className="tag tag-success">启用</span>
                    ) : (
                      <span className="tag tag-default">禁用</span>
                    )}
                  </td>
                  <td>
                    <button className="btn" style={{ marginRight: 8 }}>编辑</button>
                    <button className="btn btn-danger">删除</button>
                  </td>
                </tr>
              ))}
              {bindings.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                    暂无绑定
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
