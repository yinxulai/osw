import { runSteps } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const supportedArguments = new Set(['--mac', '--win', '--linux', '--arm64', '--x64'])
const platformArguments = new Set(['--mac', '--win', '--linux'])
const architectureArguments = new Set(['--arm64', '--x64'])

const main = async () => {
  const builderArguments = process.argv.slice(2)
  const unsupportedArguments = builderArguments.filter(argument => !supportedArguments.has(argument))
  if (unsupportedArguments.length > 0) {
    log.error(`Unsupported build arguments: ${unsupportedArguments.join(', ')}`)
    process.exit(1)
  }

  const platforms = builderArguments.filter(argument => platformArguments.has(argument))
  if (platforms.length > 1) {
    log.error('Build only one target platform at a time')
    process.exit(1)
  }

  const architectures = builderArguments.filter(argument => architectureArguments.has(argument))
  const sharedArguments = builderArguments.filter(argument => !architectureArguments.has(argument))
  const publishArguments = ['--publish', 'never']
  const packagingSteps = architectures.length > 1
    ? architectures.map(architecture => ({
        command: 'pnpm',
        args: ['electron-builder', '--config', 'electron-builder.config.cjs', ...sharedArguments, ...publishArguments, architecture],
        label: `Packaging ${architecture.slice(2)}`,
      }))
    : [{
        command: 'pnpm',
        args: ['electron-builder', '--config', 'electron-builder.config.cjs', ...builderArguments, ...publishArguments],
        label: 'Packaging with electron-builder',
      }]

  log.title('Building One Switch')

  try {
    await runSteps([
      { command: 'pnpm', args: ['typecheck'], label: 'Type checking' },
      { command: 'pnpm', args: ['vite', 'build'], label: 'Bundling with Vite' },
      ...packagingSteps,
    ])
  } catch (error) {
    log.error(error.message)
    process.exit(1)
  }
}

main()
