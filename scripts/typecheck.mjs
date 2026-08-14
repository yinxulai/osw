import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const main = async () => {
  log.title('Type checking')
  try {
    await run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.check.json'])
    log.success('Type check passed')
  } catch (error) {
    log.error('Type check failed')
    process.exit(1)
  }
}

main()
