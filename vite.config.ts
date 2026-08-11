import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'source/command/index.ts',
        vite: {
          build: {
            outDir: 'dist/command',
            rollupOptions: {
              external: ['better-sqlite3', 'electron'],
            },
          },
          resolve: {
            alias: {
              '@common': path.resolve(__dirname, 'source/common'),
              '@server': path.resolve(__dirname, 'source/server'),
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'source/command/preload.ts'),
        vite: {
          build: {
            outDir: 'dist/command',
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, 'source/common'),
      '@render': path.resolve(__dirname, 'source/render'),
    },
  },
  root: 'source/render',
  build: {
    outDir: path.resolve(__dirname, 'dist/render'),
    emptyOutDir: true,
  },
})
