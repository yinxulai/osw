import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import tailwindcss from '@tailwindcss/vite'

const previewOnly = process.env.VITE_PREVIEW_ONLY === 'true'
const projectRoot = fileURLToPath(new URL('./', import.meta.url))

const commonAlias = {
  '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
  '@server': fileURLToPath(new URL('./source/server', import.meta.url)),
}

const renderAlias = {
  '@': fileURLToPath(new URL('./source/render/source', import.meta.url)),
  '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
  '@render': fileURLToPath(new URL('./source/render', import.meta.url)),
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(previewOnly
      ? []
      : [
          electron([
            // Main process
            {
              entry: fileURLToPath(new URL('./source/command/index.ts', import.meta.url)),
              vite: {
                build: {
                  outDir: fileURLToPath(new URL('./dist/command', import.meta.url)),
                  rolldownOptions: {
                    external: ['better-sqlite3', 'electron'],
                  },
                },
                resolve: { alias: commonAlias },
              },
              onstart({ startup }) {
                startup([projectRoot, '--no-sandbox'])
              },
            },
            // Preload
            {
              entry: fileURLToPath(new URL('./source/command/preload.ts', import.meta.url)),
              vite: {
                build: {
                  outDir: fileURLToPath(new URL('./dist/command', import.meta.url)),
                },
              },
              onstart({ reload }) {
                reload()
              },
            },
          ]),
        ]),
  ],
  resolve: { alias: renderAlias },
  root: 'source/render',
  build: {
    outDir: fileURLToPath(new URL('./dist/render', import.meta.url)),
    emptyOutDir: true,
  },
})
