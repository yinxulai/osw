import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { alias, nodeBuild, nodeDefine, nodeExternals } from './vite.shared.js'

// 无头截图补拍入口：见 `source/screenshot-export-entry.ts`。
// 单独一份构建而不是并进主进程产物，是因为它只在「重拍截图」时需要——主进程不需要懂它，
// 打包产物里也不该多一个入口。产物与主进程同层（`output/command`），用
// `electron output/command/screenshot-export.js` 直接跑。
export default defineConfig({
  define: nodeDefine,
  resolve: { alias },
  build: {
    ...nodeBuild,
    lib: {
      entry: fileURLToPath(new URL('./source/screenshot-export-entry.ts', import.meta.url)),
      formats: ['es'],
      // 名字必须固定：`scripts/screenshots.mjs` 按 `screenshot-export.js` 精确寻址它，
      // 默认会按源文件名（`screenshot-export-entry.js`）输出，那就对不上了。
      fileName: () => 'screenshot-export.js',
    },
    rolldownOptions: {
      external: nodeExternals,
      // 与主进程同一条理由：不声明就会按浏览器解包依赖的内置模块引用。
      platform: 'node',
      output: {
        entryFileNames: 'screenshot-export.js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
})
