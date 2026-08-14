/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.yinxulai.one-switch',
  productName: 'One Switch',
  directories: {
    output: 'release/${version}',
  },
  files: [
    'dist',
    '!dist/**/*.map',
  ],
  mac: {
    target: ['dmg'],
    category: 'public.app-category.developer-tools',
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
