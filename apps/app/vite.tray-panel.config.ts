import { defineConfig } from 'vite'
import { alias, nodeBuild, nodeDefine, nodeExternals, trayPanelPreloadEntry } from './vite.shared.js'

// 托盘面板专用 preload。与主窗口的 preload 分开构建：它只暴露面板需要的五个固定动作，
// 不携带控制台的 updater/runtime 能力。输出必须是 CommonJS，理由与主 preload 相同。
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
