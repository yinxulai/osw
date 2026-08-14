import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const usage = `
Usage: node scripts/db.mjs <command>

Commands:
  generate   Generate a new migration from schema changes
  migrate    Apply pending migrations
  studio     Open Drizzle Studio
`

const main = async () => {
  const [command] = process.argv.slice(2)

  const commands = {
    generate: ['drizzle-kit', 'generate'],
    migrate: ['drizzle-kit', 'migrate'],
    studio: ['drizzle-kit', 'studio'],
  }

  if (!commands[command]) {
    log.error(`Unknown command "${command}"`)
    console.log(usage)
    process.exit(1)
  }

  log.title(`DB — ${command}`)
  try {
    await run('pnpm', commands[command])
    log.success(`Done: ${command}`)
  } catch (error) {
    log.error(`DB command failed: ${command}`)
    process.exit(1)
  }
}

main()
