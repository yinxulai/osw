import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const main = async () => {
  log.title('Running server tests')
  try {
    await run(
      'pnpm',
      ['exec', 'electron', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    )
    log.success('All tests passed')
  } catch (error) {
    log.error('Tests failed')
    process.exit(1)
  }
}

main()
