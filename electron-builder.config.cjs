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
  afterPack: 'scripts/macos-adhoc-sign.cjs',
  mac: {
    target: ['dmg'],
    category: 'public.app-category.developer-tools',
    identity: null,
    notarize: false,
  },
  win: {
    target: ['nsis'],
    signAndEditExecutable: false,
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
}
