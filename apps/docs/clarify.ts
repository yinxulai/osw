import { defineConfig } from '@clarify-labs/cli'

// OSW 使用手册的站点结构。
//
// 这里只声明「有哪些页、怎么分组」；每页的正文在 `source/` 下的 MDX 里。
//
// 分组顺序就是使用者的心智路径，也是本手册的布局原则（见 README.md）：
//   认识它（index/concepts）
//   → 跑起来（installation/quick-start）
//   → 接上游（providers/logical-models/routing/failover/cache-affinity）
//   → 接客户端（protocols/client-config）
//   → 处理请求（rewrite/outbound-proxy）
//   → 看运行结果（request-logs/analytics/runtime-logs）
//   → 管数据与安全（data/cloud-sync/privacy）
//   → 查参考与排查（settings/cli/troubleshooting/limitations）
//
// 分组只服务于导航：同一件事只在一页里展开，跨页只写一句结论加链接。
export default defineConfig({
  title: 'OSW 使用手册',
  description: '本地 AI 网关：一个地址接住所有客户端，自动故障转移。',
  logo: '/logo.svg',
  favicon: '/favicon.svg',
  theme: {
    preset: 'default',
    tokens: {
      colors: {
        // 品牌色取自标志渐变上的两个锚点（见 apps/www 的设计 token）。
        primary: '#f0297c',
        accent: '#7c3aed',
      },
    },
  },
  navigation: {
    menus: [
      { label: '快速开始', href: '/quick-start' },
      { label: 'GitHub', href: 'https://github.com/yinxulai/osw' },
    ],
    tabs: [
      {
        tab: '使用指南',
        icon: 'BookOpen',
        pages: [
          {
            group: '认识 OSW',
            icon: 'Sparkles',
            pages: [
              { page: 'index', title: 'OSW 是什么', icon: 'Sparkles' },
              { page: 'concepts', title: '核心概念', icon: 'Shapes' },
            ],
          },
          {
            group: '跑起来',
            icon: 'Rocket',
            pages: [
              { page: 'installation', title: '安装与启动', icon: 'Download' },
              { page: 'quick-start', title: '三步搭好网关', icon: 'Flag' },
            ],
          },
          {
            group: '接入上游',
            icon: 'Network',
            pages: [
              { page: 'providers', title: '供应商与模型', icon: 'Server' },
              { page: 'logical-models', title: '逻辑模型', icon: 'Layers' },
              { page: 'routing', title: '请求选路', icon: 'Waypoints' },
              { page: 'failover', title: '故障转移', icon: 'HeartPulse' },
              { page: 'cache-affinity', title: '缓存亲和', icon: 'Link' },
            ],
          },
          {
            group: '接入客户端',
            icon: 'Plug',
            pages: [
              { page: 'protocols', title: '本服务支持的协议', icon: 'Braces' },
              { page: 'client-config', title: '客户端配置', icon: 'Wrench' },
            ],
          },
          {
            group: '处理请求',
            icon: 'Filter',
            pages: [
              { page: 'rewrite', title: '请求重写', icon: 'Replace' },
              { page: 'outbound-proxy', title: '上游代理', icon: 'Shield' },
            ],
          },
          {
            group: '观测与排查',
            icon: 'Activity',
            pages: [
              { page: 'request-logs', title: '请求记录', icon: 'ListFilter' },
              { page: 'analytics', title: '统计分析', icon: 'ChartColumn' },
              { page: 'runtime-logs', title: '运行日志', icon: 'Terminal' },
            ],
          },
          {
            group: '数据与安全',
            icon: 'Database',
            pages: [
              { page: 'data', title: '数据目录与保留', icon: 'HardDrive' },
              { page: 'cloud-sync', title: '配置云同步', icon: 'CloudUpload' },
              { page: 'privacy', title: '本地优先与密钥', icon: 'Lock' },
            ],
          },
          {
            group: '参考',
            icon: 'BookMarked',
            pages: [
              { page: 'settings', title: '设置项', icon: 'SlidersHorizontal' },
              { page: 'cli', title: '命令行', icon: 'SquareTerminal' },
              { page: 'troubleshooting', title: '常见问题', icon: 'LifeBuoy' },
              { page: 'limitations', title: '不支持的边界', icon: 'CircleSlash' },
            ],
          },
        ],
      },
    ],
  },
  footer: {
    copyright: '© 2026 OSW. 本地 AI 网关使用手册。',
    links: [
      { label: 'OSW 是什么', href: '/' },
      { label: '快速开始', href: '/quick-start' },
      { label: '常见问题', href: '/troubleshooting' },
    ],
    socials: {
      GitHub: 'https://github.com/yinxulai/osw',
    },
  },
})
