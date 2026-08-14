// 友好的终端输出工具
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

const enabled = process.stdout.isTTY

const color = (code, text) => (enabled ? `${code}${text}${colors.reset}` : text)

export const log = {
  step(step, total, message) {
    console.log(color(colors.cyan, `\n[${step}/${total}] ${message}`))
  },
  info(message) {
    console.log(color(colors.dim, `  ${message}`))
  },
  success(message) {
    console.log(color(colors.green, `\n✓ ${message}`))
  },
  warn(message) {
    console.log(color(colors.yellow, `  ⚠ ${message}`))
  },
  error(message) {
    console.log(color(colors.red, `\n✗ ${message}`))
  },
  title(message) {
    console.log(color(colors.bold, `\n${message}`))
  },
}
