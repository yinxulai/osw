import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const args = process.argv.slice(2)
const previewOnly = args.includes('--preview')

const main = async () => {
  if (previewOnly) {
    log.title('Preview mode — renderer only, Electron will not start')
  } else {
    log.title('Dev mode — starting Vite with Electron')
  }

  try {
    await run('pnpm', ['vite'], {
      env: {
        ...process.env,
        ...(previewOnly ? { VITE_PREVIEW_ONLY: 'true' } : {}),
      },
    })
  } catch (error) {
    log.error(error.message)
    process.exit(1)
  }
}

main()
