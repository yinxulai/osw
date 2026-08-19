/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.yinxulai.one-switch',
  productName: 'One Switch',
  icon: 'build/icon.png',
  directories: {
    output: 'release/${version}',
  },
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  files: [
    'dist',
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
    target: ['dmg'],
    category: 'public.app-category.developer-tools',
    identity: null,
    notarize: false,
  },
  win: {
    icon: 'build/icon.ico',
    target: ['nsis'],
    signAndEditExecutable: false,
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
}
