import { builtinModules } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import packageJson from '../../package.json' with { type: 'json' }

// 命令行宿主。单入口 ESM，产物 `output/index.js` 就是 `bin` 指向的文件
// （见 apps/docs/specs/packaging.md §5.8、§6）。
//
// 与 `apps/app/vite.config.ts` 同源但**不能共用**它的 `vite.shared.ts`：那份配置里的
// 外部化列表包含 `electron`，而 CLI 的外部化列表只要 Node 内置模块，多写一条就是多留
// 一个「CLI 悄悄依赖桌面壳」的口子（静态检查能抓 import，抓不到构建配置）。
//
// 这里的几个配置项都只在运行期暴露，且构建过程没有警告——代价与理由见
// `apps/app/vite.shared.ts` 的注释与 apps/docs/specs/packaging.md §5.8：
//   `rolldownOptions.external`：内置模块不能被换成浏览器空模块（`platform: 'node'` 不管这件事）
//   顶层 `define: { 'process.env': ... }`：不能被静态替换成 `{}`（放进 `build` 里会被忽略）
//
// 与 `apps/app/vite.shared.ts` 同一条规则，只是这里没有 `electron`：`node:` 前缀用正则，
// 而不是 `builtinModules.map(m => \`node:${m}\`)`——后者把构建机的 Node 版本写进了产物。
export default defineConfig({
  define: {
    'process.env': 'globalThis.process.env',
    // 版本号在构建期取一次。取的是**仓库根**的 `package.json`：那是唯一的发布版本权威
    // （`packages/toolkit/scripts/version.mjs` 把它写进全部 workspace manifest）。
    // 运行期读 `package.json` 会引入一条「按固定层数向上找文件」的路径假设，
    // 那正是 apps/docs/specs/packaging.md §5.8 复盘出的脆点。声明见 `source/vite-env.d.ts`，
    // 测试侧的同一份注入见 `packages/toolkit/vitest.config.ts`。
    __CLI_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    // 别名相对 `apps/cli/` 要退两层。
    alias: {
      '@common': fileURLToPath(new URL('../../packages/contracts/source', import.meta.url)),
      '@server': fileURLToPath(new URL('../../packages/core/source', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./output', import.meta.url)),
    // 清空输出目录由 `scripts/build.mjs` 负责：`output/web` 是同一个构建脚本拷进去的
    // 控制台产物，交给 Vite 的 `emptyOutDir` 会把不属于本次 Vite 构建的东西删掉。
    emptyOutDir: false,
    target: 'node22',
    // 动态 `import()` 会被 Vite 包成 `__vitePreload(() => import(...), deps)`，而那个
    // 辅助函数在 `deps` 非空时会去读 `document.getElementsByTagName('link')`——Node 里
    // 没有 `document`，于是 `await import('@server/index')` 直接抛
    // `ReferenceError: document is not defined`。
    // 这里刻意用动态 import（见 `source/native-i18n.ts` 与 `commands/start.ts`：先探测
    // `node:sqlite` 再加载 core，才能把「Node 太旧」说成人话），所以必须关掉它。
    // 注意关掉的只是「预加载依赖清单」，包装本身还在（产物里仍是 `C(() => import(...), [])`）；
    // 清单为空时辅助函数走的是 `Promise.resolve()` 那条短路分支，不会碰到 `document`。
    modulePreload: false,
    rolldownOptions: {
      input: fileURLToPath(new URL('./source/index.ts', import.meta.url)),
      external: [...builtinModules, /^node:/],
      platform: 'node',
      output: {
        // 入口文件名固定：`bin` 精确寻址 `output/index.js`，默认的哈希名会让命令直接不可用。
        entryFileNames: '[name].js',
        // 分包保持平铺（与入口同级）。`source/host.ts` 用 `import.meta.url` 定位包内
        // 的 `output/web`，多一层子目录就会算错——这个偏差只在运行期暴露。
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
})
