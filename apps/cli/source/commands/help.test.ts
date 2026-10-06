import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { CLI_COMMANDS } from '../options'
import { renderHelp } from './help'

// 帮助里左列的「代码」——旗标、取值占位、命令名——必须与真正解析 argv 的那份声明一致，
// 否则帮助会写着 `--proxy-port`、实际却只认别的拼法。命令名就此逐条对拍，不抄一遍字面量。

describe('renderHelp', () => {
  it('lists every command the parser accepts', () => {
    const help = renderHelp()
    for (const command of CLI_COMMANDS) {
      // 命令名占左列且行首两空格缩进：用行匹配，避免 `start` 这种短词在正文里被误命中。
      expect(help.split('\n').some(line => line.startsWith(`  ${command}`))).toBe(true)
    }
  })

  it('documents every flag the parser understands', () => {
    const help = renderHelp()
    for (const flag of ['-h, --help', '-v, --version', '--data-dir', '--host', '--proxy-port', '--management-port', '--web', '--no-web', '--json']) {
      expect(help, `帮助里没有 ${flag}`).toContain(flag)
    }
  })

  it('makes clear the management service is loopback only', () => {
    // 没有 `--management-host` 这个旗标：写清楚比让人翻遍选项去找更省事。
    const help = renderHelp()
    expect(help).not.toContain('--management-host')
    expect(help).toContain(createAppTranslator('en')('native.cli.managementLoopback'))
  })

  it('renders the whole thing from the catalog, with no untranslated placeholder left', () => {
    // 目录里的插值参数没填上时会留下 `{default}` 这类花括号原样文本——
    // 那是「帮助写了但没算」的迹象，比少一行更难发现。
    const help = renderHelp()
    expect(help).not.toMatch(/\{[a-zA-Z]+\}/)
    expect(help).toContain('Usage: osw [command] [options]')
  })

  it('pads the left column so the two-column layout holds', () => {
    // 左列定宽 26：取值默认值再长也不该把右列顶歪（默认数据目录往往很长）。
    const optionLines = renderHelp()
      .split('\n')
      .filter(line => line.startsWith('  --') || line.startsWith('  -h') || line.startsWith('  -v'))
    expect(optionLines.length).toBeGreaterThan(5)
    for (const line of optionLines) {
      expect(line[1]).toBe(' ')
      expect(line[2]).not.toBe(' ')
    }
  })
})
