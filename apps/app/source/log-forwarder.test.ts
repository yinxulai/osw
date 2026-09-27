import { afterEach, describe, expect, it } from 'vitest'
import { installLogForwarding, setLogSink, type ForwardedLogLine } from './log-forwarder'

/**
 * 宿主 console 转发。
 *
 * 这里测的是**补送顺序**这一件事：横幅发出时服务进程还不存在，所以它必须先被攒住、
 * 再在落点接上之后按原顺序补送；顺序错了运行日志页面上的启动过程就读不通了。
 */
describe('host log forwarding', () => {
  afterEach(() => {
    setLogSink(null)
  })

  it('buffers before the sink exists, then replays in order and keeps mapping', () => {
    // 两次安装：拦截必须幂等，否则同一行会被记两遍。
    installLogForwarding()
    installLogForwarding()

    const lines: ForwardedLogLine[] = []

    // 启动横幅这一类输出落在「服务还没起来」的窗口里。
    console.log('banner line')
    console.warn('warning line')

    setLogSink(line => lines.push(line))

    console.debug('debug line')
    console.error('error line')

    expect(lines.map(line => [line.level, line.message])).toEqual([
      ['info', 'banner line'],
      ['warn', 'warning line'],
      ['debug', 'debug line'],
      ['error', 'error line'],
    ])
    for (const line of lines) expect(typeof line.timestamp).toBe('number')
  })

  it('re-buffers output when the sink disconnects and flushes it on reconnect', () => {
    installLogForwarding()

    const beforeDisconnect: ForwardedLogLine[] = []
    setLogSink(line => beforeDisconnect.push(line))
    console.log('delivered before disconnect')

    setLogSink(null)
    console.warn('buffered during disconnect')

    const afterReconnect: ForwardedLogLine[] = []
    setLogSink(line => afterReconnect.push(line))
    console.error('delivered after reconnect')

    expect(beforeDisconnect.map(line => line.message)).toEqual(['delivered before disconnect'])
    expect(afterReconnect.map(line => [line.level, line.message])).toEqual([
      ['warn', 'buffered during disconnect'],
      ['error', 'delivered after reconnect'],
    ])
  })
})
