import { builtinModules } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import type { UserConfig } from 'vite'

// 主进程、preload、核心服务进程是三次独立构建（输出格式与运行环境都不同），但共享同样的
// 入口约定与别名。这些常量放在这里，免得几份配置各写一遍、然后慢慢长歪。

export const mainEntry = fileURLToPath(new URL('./source/index.ts', import.meta.url))
export const preloadEntry = fileURLToPath(new URL('./source/preload.ts', import.meta.url))
export const trayPanelPreloadEntry = fileURLToPath(new URL('./source/tray-panel-preload.ts', import.meta.url))

// 核心服务进程入口。产物落在 `output/command` 里，和主进程同一层，理由是这里的路径都是
// `__dirname` 相关的运行期路径，typecheck / lint / 单测都照不到：
//   - 迁移基线：`packages/core/source/database/index.ts` 从 `import.meta.url` 往上找
//     `packages/core/drizzle`。放在 `output/command/` 就和主进程同深度，两者不会因为
//     一方挪了目录而各上溯不同的层数（开发态再往上才是仓库根，打包态到 asar 根）。
//   - 入口名是运行期约定：`server-host.ts` 按名字找 `service-main.mjs`
//     （名字由 `vite.server.config.ts` 的 `entryFileNames` 钉死）。
export const serviceEntry = fileURLToPath(new URL('./source/service.ts', import.meta.url))

// 输出目录名不是随意的。打包后这一段落在 asar 的 `output/command`，而主进程代码用
// `__dirname` 反推两个位置：
//   `__dirname/..`    → `output`，渲染层静态产物所在处（`loadFile(output/render/index.html)`）
//   `__dirname/../..` → 应用根（asar 根），`packages/core/drizzle` 迁移基线的探测起点
// 这两条都是运行期路径，typecheck / lint / 单测都看不见它们。改名必须同步改
// `electron-builder.config.cjs` 里的映射与 `packages/core/source/database/index.ts` 的候选列表。
//
// 目录名统一叫 `output`（不再用 `dist`）：仓库里三份产物目录（console / app / cli）
// 与两个 Worker（`apps/apis`、`apps/www`）现在同名，`turbo.json` 的 `outputs`、
// `.gitignore` 与 eslint 的 ignores 也就只需要一套模式。
export const outputDirectory = fileURLToPath(new URL('./output/command', import.meta.url))

// 宿主只认识自己与两个内部包；渲染层不在这里构建（见 `packages/console/vite.config.ts`）。
// 注意这里要退两层：别名是相对 `apps/app/` 而不是相对仓库根。
export const alias = {
  '@common': fileURLToPath(new URL('../../packages/contracts/source', import.meta.url)),
  '@server': fileURLToPath(new URL('../../packages/core/source', import.meta.url)),
}

// 三次构建共用同一个输出目录，所以三边都不能让 Vite 清空它：任何一次 `emptyOutDir`
// 都会抹掉另外两边的产物（`--watch` 下尤其明显——改主进程会把 preload.js 删掉而不会重建）。
// 清空由 `scripts/build.mjs` 在构建前统一做一次。
//
// `assetsInlineLimit: Infinity`：图标必须编成 data URL。托盘图标是用
// `nativeImage.createFromDataURL()` 消费导入值的，拿到相对文件路径会直接报错；
// 主进程产物里也不该出现需要单独寻址的资源文件。
export const sharedBuild = {
  outDir: outputDirectory,
  emptyOutDir: false,
  assetsInlineLimit: Infinity,
} satisfies UserConfig['build']

// 宿主进程跑在 Node 里，不是浏览器里——但 rolldown 默认按浏览器解包依赖：没被列进
// `external` 的内置模块会被换成「浏览器兼容」空模块，构建期只留一句警告，运行期才炸
// （`TypeError: me.DatabaseSync is not a constructor` 就是这么来的）。
// 注意 `platform: 'node'` 不负责这件事，它只管解析条件与 CJS 互操作，外部化必须显式声明。
//
// `node:` 前缀用**正则**、不展开 `builtinModules`：那是**构建机**的清单，Node 22 里没有
// `sqlite`、Node 24 里有，于是同一个 commit 在两台机器上编出不同的包（1.1.0-beta.3 的
// 启动失败）。`node:` 这个 scheme 按定义只属于内置模块，照抄进产物就对了，不必问构建机。
export const nodeExternals = [
  'electron',
  ...builtinModules,
  /^node:/,
]

// 对齐 Electron 37 自带的 Node（22.x）。目标是让产物里的语法与内置模块按 Node 解析，
// 而不是按浏览器的 baseline 目标降级。
export const nodeTarget = 'node22'

// Vite 的默认构建环境叫 `client`，它会把 `process.env` 整体静态替换成 `{}`（浏览器语义），
// 于是 `process.env.VITE_DEV_SERVER_URL` 变成 `{}.VITE_DEV_SERVER_URL`——恒为 undefined。
// 主进程恰好靠它区分开发态与打包态（`apps/app/source/index.ts`），被替换掉就会静默按
// 生产端口启动、也不去加载 dev server，且没有任何警告。这里在顶层 `define` 把它改写成
// `globalThis.process.env`：既保留运行期真实的 env 读取，也不会自引用。
// 注意 `define` 是 Vite 的顶层选项，放进 `build` 里会被忽略。
export const nodeDefine = {
  'process.env': 'globalThis.process.env',
}

export const nodeBuild = {
  ...sharedBuild,
  target: nodeTarget,
  // 与 `apps/cli/vite.config.ts` 同一条理由：Vite 会把动态 `import()` 包成
  // `__vitePreload(() => import(...), deps)`，而那个辅助函数在 `deps` 非空时会去读
  // `document.getElementsByTagName('link')`——宿主进程里没有 `document`，一旦出现带
  // 依赖清单的动态导入，就会在运行期炸 `ReferenceError: document is not defined`。
  // 主进程目前没有任何动态导入（产物里那份 `preload-helper-*.js` 只有 import、没有调用），
  // 所以这一行今天没有可观察效果，是**纯防御**：真正要防的是「哪天给主进程加一个动态
  // 导入」，而那一刻没有人会想起来回头改构建配置。
  modulePreload: false,
} satisfies UserConfig['build']
