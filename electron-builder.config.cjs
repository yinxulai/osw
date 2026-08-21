/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.yinxulai.one-switch',
  productName: 'One Switch',
  icon: 'build/icon.png',
  directories: {
    output: 'release/${version}',
  },
  // 注意：文件名不能包含空格。GitHub 会把 release 资产文件名中的空格替换为 "."，
  // 而 electron-updater 按 latest*.yml 中的原始文件名拼接下载 URL，会导致 404。
  artifactName: 'One-Switch-${version}-${os}-${arch}.${ext}',
  files: [
    'dist',
    'drizzle',
    '!dist/**/*.map',
  ],
  // electron-updater 使用 GitHub Releases 作为更新源。
  // 打包时仍以 --publish never 运行，发布时手动上传 release 产物
  // （含 latest.yml / latest-mac.yml），客户端通过 GitHub API 检查更新。
  publish: {
    provider: 'github',
    owner: 'yinxulai',
    repo: 'one-switch',
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
    // 嵌入到 One Switch.exe 中，导致 Windows 任务栏/窗口显示 Electron 默认图标。
    // 未配置代码签名证书时，electron-builder 会自动跳过签名步骤（仅输出警告）。
  },
  linux: {
    icon: 'build/icon.png',
    target: ['AppImage'],
    category: 'Development',
  },
}
