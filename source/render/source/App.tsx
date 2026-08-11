import { useState, useEffect } from 'react'
import {
  Layers,
  Settings,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  CircleDot,
  type LucideIcon,
} from 'lucide-react'
import QueuePage from './pages/QueuePage'
import ProvidersPage from './pages/ProvidersPage'
import OverviewPage from './pages/OverviewPage'
import SettingsPage from './pages/SettingsPage'
import './styles.css'

type PageKey = 'queue' | 'providers' | 'overview' | 'settings'

interface NavItem {
  key: PageKey
  label: string
  icon: LucideIcon
  section?: string
}

const navItems: NavItem[] = [
  { key: 'queue', label: '模型队列', icon: Layers, section: '主要' },
  { key: 'providers', label: '供应商', icon: Plug, section: '主要' },
  { key: 'overview', label: '统计分析', icon: BarChart3, section: '数据' },
  { key: 'settings', label: '设置', icon: Settings, section: '系统' },
]

function App() {
  const [activePage, setActivePage] = useState<PageKey>('queue')
  const [collapsed, setCollapsed] = useState(false)

  // 响应式：小屏幕自动折叠
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 900) {
        setCollapsed(true)
      }
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  const handleNavClick = (key: PageKey) => {
    setActivePage(key)
  }

  const sections = Array.from(new Set(navItems.map(i => i.section || ''))).filter(Boolean)

  return (
    <div className="app">
      {/* 侧边栏 */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <CircleDot size={20} />
          </div>
          {!collapsed && (
            <div className="sidebar-logo-text">
              <h1>One Switch</h1>
              <p>本地大模型代理切换</p>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {sections.map(section => (
            <div key={section} className="nav-section">
              {!collapsed && <div className="nav-section-title">{section}</div>}
              {navItems
                .filter(i => i.section === section)
                .map(item => {
                  const ItemIcon = item.icon
                  return (
                    <button
                      key={item.key}
                      className={`nav-item ${activePage === item.key ? 'active' : ''}`}
                      onClick={() => handleNavClick(item.key)}
                      title={collapsed ? item.label : ''}
                    >
                      <ItemIcon size={18} className="nav-item-icon" />
                      {!collapsed && <span>{item.label}</span>}
                    </button>
                  )
                })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {collapsed ? (
            <span className="status-dot" title="服务运行中 · 端口 9300"></span>
          ) : (
            <>
              <span className="status-dot"></span>
              服务运行中 · 端口 9300
            </>
          )}
        </div>

        {/* 折叠按钮 */}
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </aside>

      {/* 主内容区 */}
      <main className="main">
        <div className="page">
          {activePage === 'queue' && <QueuePage />}
          {activePage === 'providers' && <ProvidersPage />}
          {activePage === 'overview' && <OverviewPage />}
          {activePage === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

export default App
