import { useEffect, useState } from 'react'
import { settingsApi } from '../api'
import type { Settings } from '@common/schemas'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadSettings = async () => {
    setLoading(true)
    const res = await settingsApi.get()
    if (res.success) {
      setSettings(res.data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    const res = await settingsApi.update(settings)
    if (res.success) {
      setSettings(res.data)
    }
    setSaving(false)
  }

  const updateField = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
  }

  if (loading || !settings) {
    return (
      <div>
        <div className="page-header">
          <h2>设置</h2>
        </div>
        <div className="card">
          <p style={{ color: '#999', textAlign: 'center', padding: 24 }}>加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h2>设置</h2>
        <p>全局配置项</p>
      </div>

      <div className="card">
        <h3>服务监听</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              监听地址
            </label>
            <input
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.listenHost}
              onChange={e => updateField('listenHost', e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              监听端口
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.listenPort}
              onChange={e => updateField('listenPort', parseInt(e.target.value) || 9300)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>故障切换</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              连续失败阈值
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.consecutiveFailureThreshold}
              onChange={e => updateField('consecutiveFailureThreshold', parseInt(e.target.value) || 3)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              冷却基础时间（秒）
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.cooldownBaseSeconds}
              onChange={e => updateField('cooldownBaseSeconds', parseInt(e.target.value) || 30)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              冷却最大时间（秒）
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.cooldownMaxSeconds}
              onChange={e => updateField('cooldownMaxSeconds', parseInt(e.target.value) || 300)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>超时设置</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              空闲超时（毫秒）
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.idleTimeoutMilliseconds}
              onChange={e => updateField('idleTimeoutMilliseconds', parseInt(e.target.value) || 30000)}
            />
            <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              服务端连续无数据返回的超时时间
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              日志保留条数
            </label>
            <input
              type="number"
              className="btn"
              style={{ width: '100%', textAlign: 'left' }}
              value={settings.logRetentionCount}
              onChange={e => updateField('logRetentionCount', parseInt(e.target.value) || 1000)}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  )
}
