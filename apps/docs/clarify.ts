import { defineConfig } from '@clarify-labs/cli'

// OSW 使用手册的站点结构。
//
// 这里只声明「有哪些页、怎么分组」；每页的正文在 `source/` 下的 MDX 里。
//
// 站点分四个 tab，每个 tab 回答读者在不同阶段的一个问题，而不是把 23 页
// 全塞进一个「使用指南」：
//
//   开始使用（Rocket）——「我能不能把它跑起来？」
//     认识 OSW（index/concepts）→ 跑起来（installation/quick-start）
//     → 接入客户端（protocols/client-config）
//   上游与路由（Network）——「请求到底怎么走？」
//     接入上游（providers/logical-models/routing/failover/cache-affinity）
//     → 处理请求（rewrite/outbound-proxy）
//   观测与数据（Activity）——「跑起来之后我怎么看、怎么管？」
//     观测与排查（request-logs/analytics/runtime-logs）
//     → 数据与安全（data/cloud-sync/privacy）
//   参考（BookMarked）——「具体某一项叫什么、怎么填？」
//     配置与接口（settings/cli）→ 排查与边界（troubleshooting/limitations）
//
// 为什么不叫「使用指南」当唯一的 tab：整个站就是使用手册，用它当 tab 名是
// 同义反复，读者点进去还得自己找。按上面的问题切分后，tab 名本身就能让人
// 判断「我要找的东西在不在这里」。
//
// tab 与分组只服务于导航：同一件事只在一页里展开，跨页只写一句结论加链接。
//
// ── 多语言 ───────────────────────────────────────────────────────────────
// 中文是**主要维护语言**（default）：它占据根路径（`/installation`），是内容
// 的权威版本；英文挂在 `/en` 前缀下（`/en/installation`）。带语言前缀的链接
// （`/zh/...`、`/en/...`）永远稳定，默认语言另有无前缀的「裸路径」别名。
//
// 正文按 `source/zh/` 与 `source/en/` 分目录，两边的文件与 slug 一一对应。
// `missing: 'fallback'` 表示：英文缺哪一页，该页就自动回退到中文，而不是 404
// ——这让英文可以**增量补译**，站点任何时刻都不会出现断页。
//
// 译制进度与「哪些页已有英文」只维护一处，见 ./README.md 的对照表；本文件只
// 负责导航，不重复记录进度。
//
// 导航、页脚、tab/分组/页标题都写成 { zh, en } 两语，随当前语言切换；站点级
// 的 `title` / `description` 仍是单值字符串（即默认语言中文），用于 SEO。
const zh = (zhText: string, enText: string) => ({ zh: zhText, en: enText })

export default defineConfig({
  title: 'OSW 使用手册',
  description: '本地 AI 网关：一个地址接住所有客户端，自动故障转移。',
  // 规范站点地址：生成 sitemap.xml / robots.txt，并给每页输出 canonical 与
  // hreflang 备用链接。
  siteUrl: 'https://docs.osw.yinxulai.com',
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
  // 中文为默认语言（根路径 + 权威版本），英文挂 /en 前缀，缺译自动回退中文。
  locales: {
    default: 'zh',
    missing: 'fallback',
    locales: [
      { code: 'zh', label: '中文' },
      { code: 'en', label: 'English' },
    ],
  },
  navigation: {
    menus: [
      { label: zh('快速开始', 'Quick start'), href: '/quick-start' },
      { label: 'GitHub', href: 'https://github.com/yinxulai/osw' },
    ],
    tabs: [
      {
        tab: zh('开始使用', 'Get started'),
        icon: 'Rocket',
        pages: [
          {
            group: zh('认识 OSW', 'Meet OSW'),
            icon: 'Sparkles',
            pages: [
              { page: 'index', title: zh('OSW 是什么', 'What is OSW'), icon: 'Sparkles' },
              { page: 'concepts', title: zh('核心概念', 'Core concepts'), icon: 'Shapes' },
            ],
          },
          {
            group: zh('跑起来', 'Get it running'),
            icon: 'Rocket',
            pages: [
              { page: 'installation', title: zh('安装与启动', 'Install & run'), icon: 'Download' },
              { page: 'quick-start', title: zh('三步搭好网关', 'Three steps to a gateway'), icon: 'Flag' },
            ],
          },
          {
            group: zh('接入客户端', 'Connect clients'),
            icon: 'Plug',
            pages: [
              { page: 'protocols', title: zh('本服务支持的协议', 'Supported protocols'), icon: 'Braces' },
              { page: 'client-config', title: zh('客户端配置', 'Client configuration'), icon: 'Wrench' },
            ],
          },
        ],
      },
      {
        tab: zh('上游与路由', 'Upstreams & routing'),
        icon: 'Network',
        pages: [
          {
            group: zh('接入上游', 'Connect upstreams'),
            icon: 'Network',
            pages: [
              { page: 'providers', title: zh('供应商与模型', 'Providers & models'), icon: 'Server' },
              { page: 'logical-models', title: zh('逻辑模型', 'Logical models'), icon: 'Layers' },
              { page: 'routing', title: zh('请求选路', 'Request routing'), icon: 'Waypoints' },
              { page: 'failover', title: zh('故障转移', 'Failover'), icon: 'HeartPulse' },
              { page: 'cache-affinity', title: zh('缓存亲和', 'Cache affinity'), icon: 'Link' },
            ],
          },
          {
            group: zh('处理请求', 'Shape requests'),
            icon: 'Filter',
            pages: [
              { page: 'rewrite', title: zh('请求重写', 'Request rewriting'), icon: 'Replace' },
              { page: 'outbound-proxy', title: zh('上游代理', 'Outbound proxy'), icon: 'Shield' },
            ],
          },
        ],
      },
      {
        tab: zh('观测与数据', 'Observability & data'),
        icon: 'Activity',
        pages: [
          {
            group: zh('观测与排查', 'Observe & diagnose'),
            icon: 'Activity',
            pages: [
              { page: 'request-logs', title: zh('请求记录', 'Request logs'), icon: 'ListFilter' },
              { page: 'analytics', title: zh('统计分析', 'Analytics'), icon: 'ChartColumn' },
              { page: 'runtime-logs', title: zh('运行日志', 'Runtime logs'), icon: 'Terminal' },
            ],
          },
          {
            group: zh('数据与安全', 'Data & security'),
            icon: 'Database',
            pages: [
              { page: 'data', title: zh('数据目录与保留', 'Data directory & retention'), icon: 'HardDrive' },
              { page: 'cloud-sync', title: zh('配置云同步', 'Config cloud sync'), icon: 'CloudUpload' },
              { page: 'privacy', title: zh('本地优先与密钥', 'Local-first & secrets'), icon: 'Lock' },
            ],
          },
        ],
      },
      {
        tab: zh('参考', 'Reference'),
        icon: 'BookMarked',
        pages: [
          {
            group: zh('配置与接口', 'Config & CLI'),
            icon: 'SlidersHorizontal',
            pages: [
              { page: 'settings', title: zh('设置项', 'Settings'), icon: 'SlidersHorizontal' },
              { page: 'cli', title: zh('命令行', 'Command line'), icon: 'SquareTerminal' },
            ],
          },
          {
            group: zh('排查与边界', 'Troubleshooting & limits'),
            icon: 'LifeBuoy',
            pages: [
              { page: 'troubleshooting', title: zh('常见问题', 'Troubleshooting'), icon: 'LifeBuoy' },
              { page: 'limitations', title: zh('不支持的边界', 'Limitations'), icon: 'CircleSlash' },
            ],
          },
        ],
      },
    ],
  },
  footer: {
    copyright: zh('© 2026 OSW. 本地 AI 网关使用手册。', '© 2026 OSW. Local AI gateway handbook.'),
    links: [
      { label: zh('OSW 是什么', 'What is OSW'), href: '/' },
      { label: zh('快速开始', 'Quick start'), href: '/quick-start' },
      { label: zh('常见问题', 'Troubleshooting'), href: '/troubleshooting' },
    ],
    socials: {
      GitHub: 'https://github.com/yinxulai/osw',
    },
  },
})
