/**
 * 托盘面板专用的最小桥。
 *
 * 面板是控制台那份产物里的另一个入口，但它**不该拿到主窗口的整套能力**：一个浮在托盘
 * 边上的小窗口，用不上更新器、截图导出、全屏订阅这些东西。所以这里重新声明一遍，只留
 * 三个动作——两个是「只有宿主才做得到」的（打开主界面、退出），一个是面板把内容高度报
 * 回去（窗口尺寸由内容决定）。
 *
 * 除此之外面板块唯一还需要宿主给的东西是「管理服务在哪儿」：面板同样从 `file://` 加载，
 * 从地址栏推不出端口，所以要同步注入 `window.__OSW__`——与控制台主窗口走同一个
 * `runtime:get-config`，不另开一份配置通路。
 *
 * 数据面一概不在这里：面板显示的代理状态、逻辑模型、实时请求量，全走管理 API 与实时流，
 * 和控制台完全同一条路。这里一旦多出 `getState` 之类的方法，就等于又开了一条「面板另拉
 * 一份数据」的路，正是这次要拆掉的东西。
 */

import { contextBridge, ipcRenderer } from 'electron'

const trayPanelApi = {
  openMainWindow: (): Promise<void> => ipcRenderer.invoke('tray-panel:open-main-window'),
  quit: (): void => ipcRenderer.send('tray-panel:quit'),
  resize: (height: number): void => ipcRenderer.send('tray-panel:resize', height),
}

contextBridge.exposeInMainWorld('trayPanel', trayPanelApi)

/**
 * 运行时信息。
 *
 * 同步取的理由与控制台主窗口完全相同：渲染进程从 `file://` 加载，在控制台发出第一个请求
 * 之前就得知道管理服务在哪儿。这个 handler 在 `app.whenReady()` 之前就注册好了，所以同步
 * 调用不会死等。
 */
const runtime = ipcRenderer.sendSync('runtime:get-config') as { apiBase: string }

contextBridge.exposeInMainWorld('__OSW__', {
  apiBase: runtime.apiBase,
})
