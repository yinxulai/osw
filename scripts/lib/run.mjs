import { spawn } from 'node:child_process'
import { log } from './log.mjs'

// Windows 上 pnpm/drizzle-kit 等是 .cmd 脚本，不能直接 spawn，需经由 cmd.exe /c 执行
const resolveCommand = (command) => {
  if (process.platform !== 'win32') {
    return { file: command, args: [] }
  }
  if (command.includes('.') || command.includes('/') || command.includes('\\')) {
    return { file: command, args: [] }
  }
  // 优先使用带 .cmd 的版本（pnpm、drizzle-kit 等都是 .cmd），经 cmd.exe 执行
  return { file: 'cmd.exe', args: ['/c', `${command}.cmd`] }
}

// 执行一个命令，继承 stdio，转发信号和退出码
export const run = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const { file, args: prefixArgs } = resolveCommand(command)
    const child = spawn(file, [...prefixArgs, ...args], {
      stdio: 'inherit',
      shell: false,
      ...options,
    })

    const forward = (signal) => child.kill(signal)
    const handlers = ['SIGINT', 'SIGTERM'].map((signal) => {
      process.on(signal, () => forward(signal))
      return signal
    })

    child.on('exit', (code, signal) => {
      handlers.forEach((signal) => process.removeListener(signal, forward))
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`))
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })

    child.on('error', (error) => {
      handlers.forEach((signal) => process.removeListener(signal, forward))
      reject(error)
    })
  })
}

// 顺序执行多个命令，带步骤提示
export const runSteps = async (steps) => {
  const total = steps.length
  for (let i = 0; i < total; i += 1) {
    const { command, args, label } = steps[i]
    log.step(i + 1, total, label)
    await run(command, args)
  }
  log.success('All steps completed')
}
