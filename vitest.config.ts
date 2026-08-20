import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
      '@server': fileURLToPath(new URL('./source/server', import.meta.url)),
      '@': fileURLToPath(new URL('./source/render/source', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['source/server/**/*.test.ts', 'source/render/**/*.test.ts'],
  },
})
