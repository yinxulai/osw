import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './source/server/database/schema.ts',
  out: './drizzle',
})
