import { runSteps } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const main = async () => {
  log.title('Building One Switch')

  try {
    await runSteps([
      { command: 'pnpm', args: ['typecheck'], label: 'Type checking' },
      { command: 'pnpm', args: ['vite', 'build'], label: 'Bundling with Vite' },
      {
        command: 'pnpm',
        args: ['electron-builder', '--config', 'electron-builder.config.cjs'],
        label: 'Packaging with electron-builder',
      },
    ])
  } catch (error) {
    log.error(error.message)
    process.exit(1)
  }
}

main()
