/**
 * `status`：报告另一个进程的状态。
 *
 * 只读：**不**清理失效的运行时文件（那是 `stop` 的活）。一个只读命令悄悄改磁盘上的东西，
 * 下次出问题时会让人怀疑「是不是 status 搞坏的」。
 *
 * 输出布局固定：数据缺失时用 `—` 占位，而不是少打几行。布局随数据有无变化，
 * 脚本与人眼都得重新适应一次。`--json` 走同一份报告（见 `status-report.ts`），
 * 所以两种输出永远说的是同一件事。
 *
 * 所有提示与诊断都写 stderr：stdout 要么是那 9 行固定布局，要么是一段能直接喂给
 * `JSON.parse` 的文本，两种都不该被附带信息污染。
 */

import { cliTranslator } from '../native-i18n'
import { formatEndpoint, resolveDataDirectory } from '../host'
import { callManagementApi, isPortListening } from '../management-client'
import { isProcessAlive, readRuntimeState, runtimeFilePath } from '../runtime-state'
import { renderStatusJson, renderStatusLines, type InstanceReport } from './status-report'
import type { CliArguments } from '../options'

/** 探测端口用。比一次 API 调用短得多：这里只想知道端口开没开，不是等它处理完。 */
const PORT_PROBE_TIMEOUT_MILLISECONDS = 1_000

interface ProxyStatusPayload {
  running?: unknown
  host?: unknown
  port?: unknown
}

export async function runStatus(values: CliArguments): Promise<number> {
  const t = cliTranslator()
  const dataDir = resolveDataDirectory(values.dataDir)
  const state = await readRuntimeState(dataDir)

  // 先按「没有实例」起手，再逐条按证据修正：每个字段的取值理由只有一处。
  const report: InstanceReport = {
    state: 'stopped',
    cliVersion: __CLI_VERSION__,
    dataDir,
    instanceVersion: null,
    pid: null,
    startedAt: null,
    management: null,
    proxy: null,
    consoleUrl: null,
    staleRuntimeFile: false,
    portListening: null,
  }

  if (state) {
    report.instanceVersion = state.appVersion
    report.pid = state.pid
    report.startedAt = state.startedAt
    report.management = { host: state.managementHost, port: state.managementPort }
    report.proxy = { host: state.proxyHost, port: state.proxyPort }
    report.consoleUrl = state.webUrl

    // 探一次就够：它同时回答「管理服务活着吗」与「代理现在在哪个地址」。
    // 代理实际生效的地址来自设置，可能与运行时文件里记的不同（用户在界面上改过）。
    const probe = await callManagementApi({
      host: state.managementHost,
      port: state.managementPort,
      path: '/api/proxy/status',
    })

    if (probe.ok) {
      report.state = 'running'
      const payload = probe.data as ProxyStatusPayload | null
      if (payload && typeof payload.host === 'string' && typeof payload.port === 'number') {
        report.proxy = { host: payload.host, port: payload.port }
      }
    } else if (isProcessAlive(state.pid)) {
      // 进程在，但管理服务不答应：端口没起来、或者卡住了。与「进程已消失」是两回事，
      // 再探一次端口把这两种情况分开——用户下一步该做的事完全不同。
      report.state = 'unresponsive'
      report.portListening = await isPortListening(
        state.managementHost,
        state.managementPort,
        PORT_PROBE_TIMEOUT_MILLISECONDS,
      )
    } else {
      // 进程已消失，文件是残留。状态是事实上的「未运行」；残留本身用诊断行说明，
      // 免得用户看到「未运行」却还躺着一个文件。
      // 上面已经按「实例在」填过一遍，这里必须**显式**退回 null：留着真实端口与死掉的
      // PID，会和「未运行」并列出现，读起来像「其实在跑」——而这个 pid 还能被脚本拿去用。
      report.state = 'stopped'
      report.staleRuntimeFile = true
      report.instanceVersion = null
      report.pid = null
      report.startedAt = null
      report.management = null
      report.proxy = null
      report.consoleUrl = null
    }
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(renderStatusJson(report), null, 2)}\n`)
  } else {
    for (const line of renderStatusLines(t, report)) {
      console.log(line)
    }
  }

  if (report.staleRuntimeFile) {
    // 诊断行固定英文（见 apps/docs/product/i18n.md §2），与日志共用一个 `[cli]` 前缀。
    process.stderr.write(`[cli] stale runtime file: ${runtimeFilePath(dataDir)}\n`)
  }
  if (report.state === 'unresponsive' && report.portListening === false && report.management !== null) {
    process.stderr.write(
      `${t('native.cli.status.portClosed', {
        endpoint: formatEndpoint(report.management.host, report.management.port),
      })}\n`,
    )
  }
  if (report.instanceVersion !== null && report.instanceVersion !== report.cliVersion) {
    // 版本漂移：可能是 CLI 升级了、服务还在跑旧版，也可能是两个数据目录被混用。
    // 不给结论，只把两个事实摆出来——怎么处理取决于用户为什么在跑旧版。
    process.stderr.write(
      `${t('native.cli.status.versionDrift', { instance: report.instanceVersion, cli: report.cliVersion })}\n`,
    )
  }

  return 0
}
