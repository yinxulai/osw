import { useState } from 'react'
import OverviewPage from './pages/OverviewPage'
import ProvidersPage from './pages/ProvidersPage'
import ModelsPage from './pages/ModelsPage'
import QueuePage from './pages/QueuePage'
import SettingsPage from './pages/SettingsPage'
import './App.css'

type PageKey = 'overview' | 'providers' | 'models' | 'queue' | 'settings'

const navItems: { key: PageKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'queue', label: '自动切换队列' },
  { key: 'providers', label: 'Provider 管理' },
  { key: 'models', label: '模型管理' },
  { key: 'settings', label: '设置' },
]

function App() {
  const [activePage, setActivePage] = useState<PageKey>('overview')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <h1>One Switch</h1>
          <p className="subtitle">本地大模型代理自动切换</p>
        </div>
        <nav className="nav">
          {navItems.map(item => (
            <button
              key={item.key}
              className={`nav-item ${activePage === item.key ? 'active' : ''}`}
              onClick={() => setActivePage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'queue' && <QueuePage />}
        {activePage === 'providers' && <ProvidersPage />}
        {activePage === 'models' && <ModelsPage />}
        {activePage === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export default App
