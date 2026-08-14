import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const main = async () => {
  log.title('Linting')
  try {
    await run('pnpm', ['exec', 'eslint', '.'])
    log.success('Lint passed')
  } catch (error) {
    log.error('Lint failed')
    process.exit(1)
  }
}

main()
