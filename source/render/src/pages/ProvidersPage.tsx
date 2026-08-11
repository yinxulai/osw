import { useEffect, useState } from 'react'
import { providerApi } from '../api'
import type { Provider } from '@common/schemas'

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)

  const loadProviders = async () => {
    setLoading(true)
    const res = await providerApi.list()
    if (res.success) {
      setProviders(res.data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProviders()
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这个 Provider？')) return
    const res = await providerApi.remove(id)
    if (res.success) {
      loadProviders()
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Provider 管理</h2>
        <p>管理上游模型服务提供商</p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ marginBottom: 0 }}>Provider 列表</h3>
          <button className="btn btn-primary">+ 新建 Provider</button>
        </div>

        {loading ? (
          <p style={{ color: '#999', padding: 24, textAlign: 'center' }}>加载中...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>超时时间</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.enabled ? (
                      <span className="tag tag-success">启用</span>
                    ) : (
                      <span className="tag tag-default">禁用</span>
                    )}
                  </td>
                  <td>{(p.timeoutMilliseconds / 1000).toFixed(0)}s</td>
                  <td>{new Date(p.createdTime).toLocaleString()}</td>
                  <td>
                    <button className="btn" style={{ marginRight: 8 }}>编辑</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(p.id)}>删除</button>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                    暂无 Provider，点击右上角添加
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
