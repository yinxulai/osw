import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import packageJson from '../../package.json' with { type: 'json' }

// 渲染层需要应用版本号（内置「修改 UA」模板的默认值）。主进程有 `app.getVersion()`，
// 渲染层只能异步走 updater IPC 拿 `currentVersion`，而 `dev:preview` 与单测里根本没有 Electron，
// 所以版本号在构建期取一次、`define` 成字面量注入。
//
// 取的是**仓库根**的 `package.json`：那是唯一的发布版本权威（`packages/toolkit/scripts/version.mjs`
// 负责把同一个版本号写进全部 workspace manifest）。声明见 `source/vite-env.d.ts`，
// 测试侧的同一份注入见 `packages/toolkit/vitest.config.ts`。
const appVersion = packageJson.version

// 渲染层是纯静态产物：不导入 `@server/*`，也不认识 `electron`。
// 目录职责见 apps/docs/product/packaging.md。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./source', import.meta.url)),
      '@common': fileURLToPath(new URL('../contracts/source', import.meta.url)),
      '@render': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // 生产环境由 Electron 用 `loadFile` 以 `file://` 加载，`location.origin` 是 `null`。
  // 绝对路径（默认的 `/assets/...`）在这里会解析到盘根，所以资源引用必须是相对路径。
  base: './',
  server: {
    // 端口固定：`apps/app` 的开发脚本按这个地址拼 `VITE_DEV_SERVER_URL` 交给 Electron。
    // 端口漂移时 Electron 只会加载到空白页而不会报错，所以宁可让 Vite 直接失败。
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'output',
    emptyOutDir: true,
    // 两个 HTML 入口，同一份产物：
    // - `index.html` 控制台主界面（Electron 主窗口 / 浏览器 / 命令行托管都用它）；
    // - `tray.html` 托盘面板（Electron 托盘窗口用，见 `source/tray.tsx`）。
    //
    // 合成一个入口是刻意为之：面板要显示的东西与控制台逻辑模型页是同一批数据、同一套
    // 口径。分成两份产物就等于维护两套推导与两条数据通路，它们一定会对不上——而且永远
    // 是「面板上少显示了什么」这种最难察觉的那种对不上。
    //
    // 两个文件同级，`base: './'` 的相对资源引用对两者同时成立；共用的模块被提到共享
    // chunk 里，面板不会重复下载一份 react-query 或 i18n。
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        tray: fileURLToPath(new URL('./tray.html', import.meta.url)),
      },
    },
  },
})
