import type { MenuItemConstructorOptions } from 'electron'
import { resolveProxyOrigin } from '@common/proxy-origin'
import type { NativeTranslator } from './i18n'

/**
 * 菜单与 tooltip 渲染用的代理状态快照。
 *
 * 只有这一个真相源：轮询负责刷新它，菜单和 tooltip 只从它渲染。
 */
export interface TrayProxySnapshot {
  running: boolean
  host: string | null
  port: number | null
}

/**
 * 托盘列出的两个接入基址，与引导页第三步展示的地址同口径。
 *
 * 这里给的是**客户端要填的 Base URL**，不是完整接口地址：OpenAI 兼容客户端要带 `/v1`，
 * Anthropic 客户端只填到端口（它自己会补上 `/v1/messages`）。
 * 协议名是专有名词，不进文案表，所以标签是拼出来的动态文本。
 */
export const TRAY_ENDPOINTS = [
  { label: 'OpenAI', path: '/v1' },
  { label: 'Anthropic', path: '' },
] as const

export interface TrayMenuActions {
  copyEndpoint: (endpoint: string) => void
  toggleProxy: () => void
  openWindow: () => void
  quit: () => void
}

interface TrayMenuContext {
  snapshot: TrayProxySnapshot
  t: NativeTranslator
  actions: TrayMenuActions
  /** 分组标题是 macOS 独有的原生样式，所以平台要显式传进来（也方便测试）。 */
  platform: NodeJS.Platform
}

/**
 * 按快照拼出托盘菜单模板。
 *
 * 结构与状态无关，固定为「代理服务（状态 + 复制地址 + 启停）→ 打开主界面 → 退出」：
 * 状态行不可点，但它说明下面那组操作的对象是什么；启停项的文案就是动作本身，
 * 不做勾选项——菜单里已经有状态行，勾选只是把同一件事说两遍。
 */
export function buildTrayMenuTemplate(context: TrayMenuContext): MenuItemConstructorOptions[] {
  const { snapshot, t, actions, platform } = context
  const { running, host, port } = snapshot
  const origin = resolveProxyOrigin(host, port)
  const endpoints =
    origin === null
      ? []
      : TRAY_ENDPOINTS.map(endpoint => ({
          label: `${endpoint.label} · ${origin}${endpoint.path}`,
          url: `${origin}${endpoint.path}`,
        }))

  const template: MenuItemConstructorOptions[] = []

  // 分组标题只有 macOS 有原生样式（`type: 'header'`，macOS 14+）；
  // Windows / Linux 的菜单项没有标题语义，那里只用分隔线分组。
  if (platform === 'darwin') {
    template.push({ label: t('native.tray.section.proxy'), type: 'header' })
  }

  template.push(
    {
      label: running
        ? t('native.tray.status.running', { port: port ?? 0 })
        : t('native.tray.status.stopped'),
      enabled: false,
    },
    {
      // 地址放在子菜单里逐条列出，而不是把一长串 URL 塞进菜单项：
      // 顶层保持短行，同时又能看清到底复制的是哪一个客户端的 Base URL。
      label: t('native.tray.copyEndpoint'),
      enabled: endpoints.length > 0,
      submenu: endpoints.map(entry => ({
        label: entry.label,
        click: () => actions.copyEndpoint(entry.url),
      })),
    },
    {
      // 文案就是动作本身，不做勾选项：菜单里已经有状态行，勾选只是把同一件事说两遍。
      label: running ? t('native.tray.stopProxy') : t('native.tray.startProxy'),
      click: () => actions.toggleProxy(),
    },
    { type: 'separator' },
    {
      label: t('native.tray.openWindow'),
      click: () => actions.openWindow(),
    },
    { type: 'separator' },
    {
      label: t('native.tray.quit'),
      click: () => actions.quit(),
    },
  )

  return template
}
