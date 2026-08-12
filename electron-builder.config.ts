import type { Configuration } from 'electron-builder'

export default {
  appId: 'com.oneswitch.app',
  productName: 'One Switch',
  directories: {
    output: 'release/${version}',
  },
  files: [
    'dist',
    '!dist/**/*.map',
    'node_modules/better-sqlite3/**',
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
  asarUnpack: [
    'node_modules/better-sqlite3/**',
  ],
} satisfies Configuration
