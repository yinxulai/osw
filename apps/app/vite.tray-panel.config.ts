import { defineConfig } from 'vite'
import { alias, nodeBuild, nodeDefine, nodeExternals, trayPanelPreloadEntry } from './vite.shared.js'

// 托盘面板专用 preload。与主窗口的 preload 分开构建：它只暴露面板真正需要的三个固定
// 动作（打开主界面、退出、上报内容高度）外加运行时基地址，不携带控制台的
// updater/screenshots 能力。输出必须是 CommonJS，理由与主 preload 相同。
export default defineConfig({
  define: nodeDefine,
  resolve: { alias },
  build: {
    ...nodeBuild,
    lib: {
      formats: ['cjs'],
      entry: trayPanelPreloadEntry,
      fileName: () => 'tray-panel-preload.js',
    },
    rolldownOptions: {
      external: nodeExternals,
    },
  },
})
