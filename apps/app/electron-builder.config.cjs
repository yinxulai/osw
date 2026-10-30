/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.yinxulai.osw',
  productName: 'OSW',
  icon: 'build/icon.png',
  directories: {
    output: '../../release/${version}',
  },
  // 注意：文件名不能包含空格。GitHub 会把 release 资产文件名中的空格替换为 "."，
  // 而 electron-updater 按 latest*.yml 中的原始文件名拼接下载 URL，会导致 404。
  artifactName: 'OSW-${version}-${os}-${arch}.${ext}',
  // projectDir 就是本包（`apps/app`），所以这里的路径一律相对它解析；
  // 两个 `{ from, to }` 把「不是本包构建出来的」产物抬进 asar，落到主进程代码反推的位置上：
  //   `output/render`        ← 渲染层静态产物（`__dirname/../render`）
  //   `packages/core/drizzle` ← 两条迁移链 `config/` 与 `data/`（`__dirname/../../packages/core/drizzle`）
  // 这两条映射和 `apps/app/vite.shared.ts` 里 `outputDirectory` 的命名是一组，改一处必须改全部。
  //
  // 核心服务进程的产物（`output/command/service-main.mjs` 与它的 chunk）**不在这里单独列出**：
  // 它就在 `output` 里，跟着一起进 asar。上一版之所以要把它连同迁移基线一起抬到
  // `app.asar.unpacked`，是因为服务当时跑在 `worker_threads` 线程里、线程读不了 asar
  // （Electron 只给主进程的 `fs` 装了 asar 解析）。现在服务是个真的 `utilityProcess`，
  // 走主进程同一套模块加载，asar 里的入口与它的 ESM 分包都能直接加载，于是整套
  // `extraResources` 都可以删掉——产物只剩一份，路径推导也只剩一种布局。
  files: [
    // `output` 与两个 `!` 必须**挨在一起**：electron-builder 会把连续的字符串项归一化成
    // 同一个 file set 的 `filter` 列表，而每个 `{ from, to }` 项各自独立成一个 set。
    // 一旦排除项和它要排除的正向模式被拆进两个 set，前者就退化成「只有排除项」的 set
    // ——`minimatchAll` 是逐个模式累进判定的，没有前置正向模式时排除项全部被跳过，
    // 于是静默失效。
    'output',
    '!output/**/*.map',
    // `node_modules` 整棵树都是死的：`vite.shared.ts` 的 `nodeExternals` 只外部化
    // `node:` 内置模块与 `electron`，工作区包（`@osw/*`）全部被 Vite 打进
    // `output/command/*.mjs`。但工作区包同时写在 `dependencies` 里（turbo 靠它排序构建），
    // electron-builder 于是照单收下——实测 asar 里这棵树有 3.0 MB、全是 TypeScript 源码
    // 与 `*.test.ts`，占整个 asar 的 29%。产物里没有任何一处 `import '@osw/...'`
    // 会活到运行期，所以整棵排掉。
    // 将来若真的引入一个必须留在外部的运行期依赖，要同时改 `nodeExternals` 和这里。
    '!node_modules',
    { from: '../../packages/console/output', to: 'output/render' },
    { from: '../../packages/core/drizzle', to: 'packages/core/drizzle' },
  ],
  // electron-updater 使用 GitHub Releases 作为更新源。
  // 打包时仍以 --publish never 运行，发布时手动上传 release 产物
  // （含 latest.yml / latest-mac.yml），客户端通过 GitHub API 检查更新。
  publish: {
    provider: 'github',
    owner: 'yinxulai',
    repo: 'osw',
  },
  afterPack: 'scripts/macos-adhoc-sign.cjs',
  mac: {
    icon: 'build/icon-mac.png',
    // electron-updater 在 macOS 上需要 ZIP 来执行自动更新；DMG 仅用于首次安装。
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    identity: null,
    notarize: false,
  },
  win: {
    icon: 'build/icon.ico',
    target: ['nsis'],
    // signAndEditExecutable 必须保持启用（默认值），否则 rcedit 不会将 icon.ico
    // 嵌入到 OSW.exe 中，导致 Windows 任务栏/窗口显示 Electron 默认图标。
    // 未配置代码签名证书时，electron-builder 会自动跳过签名步骤（仅输出警告）。
  },
  linux: {
    icon: 'build/icon.png',
    target: ['AppImage'],
    category: 'Development',
    // `package.json#name` 现在是 `@one-switch/app`，electron-builder 默认拿它当 Linux 可执行名。
    // 带 scope 的名字会被清洗成 `@one-switchapp`，`@` 仍留在里面 → AppImage 构建报
    // `executableName contains characters that cannot be safely used in file paths`。
    // （`app-builder-lib` 的 `LinuxPackager` 在不配这一项时回退到
    // `appInfo.sanitizedName.toLowerCase()`；写 AppRun 前会用 `/^[\p{L}\p{N}._\- ]+$/u`
    // 再校验一次，`@` 不在白名单里。只有 AppImage 会走到那段校验——`--dir` 不产出 AppRun，
    // 所以 `ci.yml` 的 `--dir` 冒烟一直是绿的，只有发布时打包 AppImage 才炸。）
    // 因此这一项**必须**显式给出，不能依赖默认值：它同时是对外约定（二进制名与 `.desktop`
    // 里的 `Name` / 图标名），不该随包名摆动。取小写纯字母，同时也是 AppDir 里
    // 二进制名与图标文件名（`Icon=` 键）。
    executableName: 'osw',
    // `.desktop` 文件名默认取 `executableName`，但 Electron 侧的 app_id / WM_CLASS 只认
    // 包内 `package.json#desktopName`（见 `apps/app/package.json`，两处必须一致）。
    // 打开它之后文件名改由 `desktopName` 派生，`StartupWMClass` 也跟着对齐成
    // `com.yinxulai.osw`，任务栏图标与窗口分组才关联得上；不开还会打印一条
    // 「desktopName is not set in package.json」的警告。
    syncDesktopName: true,
  },
}
