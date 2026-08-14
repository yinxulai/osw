import type { Configuration } from 'electron-builder'

export default {
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
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
} satisfies Configuration
