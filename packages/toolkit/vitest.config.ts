import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import packageJson from '../../package.json' with { type: 'json' }

// 整个工作区共用的一份测试配置，经同目录下的 `scripts/test.mjs` 跑起来（可按包过滤）。
//
// 住在 toolkit 而不是仓库根：唯一消费方就是那个脚本，而 vitest 接受显式的 `--config`，
// 没有哪个工具非要它在根目录；根目录只留「工具约定必须在那里找到」的文件
// （`pnpm-workspace.yaml`、`turbo.json`、被各包 `extends` 的 `tsconfig.json`、`eslint.config.js`）。
// 与 `tsconfig.check.json` 同一个归属。
//
// `root` 显式钉在仓库根，而不是让它取 `cwd`：`include`、`setupFiles` 与覆盖率目录都是
// **相对 root** 解析的，而 `define` 与别名是相对**本文件**解析的——两套基准写在同一个文件里，
// 把 root 写明才不会在配置挪位置时顺手把前三条的解释基准也挪走。
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

// 与两份 `vite.config.ts` 的 `define` 保持一致：测试同样走 Vite 的转换管线，
// 少了这一行，任何间接 import 到 `rule-presets.ts` 的用例都会因 `__APP_VERSION__` 未定义而炸。
// `__CLI_VERSION__` 同理：注入点就是这里与 `apps/cli/vite.config.ts`，声明见
// `apps/cli/source/vite-env.d.ts`。版本取的是**仓库根**的 manifest，与构建期一致。
const appVersion = packageJson.version

export default defineConfig({
  root: repositoryRoot,
  define: { __APP_VERSION__: JSON.stringify(appVersion), __CLI_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: {
      '@common': fileURLToPath(new URL('../../packages/contracts/source', import.meta.url)),
      '@server': fileURLToPath(new URL('../../packages/core/source', import.meta.url)),
      '@render': fileURLToPath(new URL('../../packages/console', import.meta.url)),
      '@': fileURLToPath(new URL('../../packages/console/source', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./packages/console/scripts/vitest.setup.ts'],
    // 注意：必须同时覆盖 .ts 与 .tsx，否则组件测试（jsdom + Testing Library）
    // 会被静默跳过，套件仍显示全绿。
    include: [
      'apps/app/source/**/*.test.{ts,tsx}',
      'apps/apis/source/**/*.test.{ts,tsx}',
      'apps/cli/source/**/*.test.{ts,tsx}',
      'apps/www/source/**/*.test.{ts,tsx}',
      'packages/core/source/**/*.test.{ts,tsx}',
      'packages/contracts/source/**/*.test.{ts,tsx}',
      'packages/console/source/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      reportsDirectory: './coverage',
      include: [
        'apps/app/source/updater.ts',
        'apps/apis/source/**/*.ts',
        'apps/cli/source/**/*.ts',
        'packages/core/source/**/*.ts',
        'packages/contracts/source/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/types.ts', '**/schemas.ts', '**/test-support.ts'],
    },
  },
})
