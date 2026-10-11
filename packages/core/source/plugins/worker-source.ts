/**
 * 插件沙箱的 worker 源码。
 *
 * **它是一段字符串，不是仓库里的一个 `.js` 文件**：worker 用 `new Worker(source, { eval: true })`
 * 起（见 `./runner.ts`），源码随包走，不需要处理「打包后这个文件在哪」——`apps/app` 把 core
 * 打进 asar 时，任何靠路径去找的独立脚本都会成为一类只在打包后才出现的故障。
 *
 * 为什么是 worker 而不是主线程 `node:vm`（路由脚本用的是后者，见
 * `../proxy/capabilities/script-sandbox.ts`）：插件会 `await` 网络，而 `node:vm` 的 `timeout`
 * **打不断 await**——一个卡住的插件会把宿主进程一直占着。worker 可以由宿主 `terminate()` 硬杀。
 *
 * worker 内部仍然用 `node:vm` 关掉 `codeGeneration`（`strings: false` / `wasm: false`），
 * 与路由脚本同一策略：插件代码**不能生成新代码**。
 *
 * 宿主能力（`http` / `secrets` / `storage` / `log`）一律走 RPC：沙箱发一条消息、宿主回一条消息，
 * 两侧交换的都是 **JSON 文本**（`ctx` 在沙箱里用 `JSON.parse` 造），因此插件那侧拿不到任何
 * 宿主对象。`parentPort` 只存在于 worker 的闭包里，从没被送进 `vm` 上下文。
 *
 * worker 的内部消息协议（宿主侧 `./runner.ts` 必须逐字对齐）：
 * - 宿主 → worker：`{ kind: 'rpc-result', id, value?, error? }`，`value` 是 JSON 文本。
 * - worker → 宿主：`{ kind: 'rpc', id, method, args }`（`args` 是**字符串化的参数数组**）。
 * - worker → 宿主（收尾）：`{ kind: 'result', ok, value?, missing?, error? }`（`value` 是 JSON 文本）。
 */
export const PLUGIN_WORKER_SOURCE = String.raw`'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')

const HOOK_NAMES = ['obtainCredential', 'listModels', 'resolveRequest']

const pluginKey = workerData.pluginKey
const entryPath = workerData.entryPath
const hookName = workerData.hookName
const inputs = workerData.inputs || {}
const request = workerData.request || null
const timeoutMilliseconds = workerData.timeoutMilliseconds
// Two separate budgets, on purpose.
//
// The context build is host startup work, not plugin work: it gets a generous floor so a cold VM
// can never eat the plugin's own budget.
const startupTimeoutMilliseconds = Math.max(10000, timeoutMilliseconds)

async function main() {
  let code
  try {
    code = readFileSync(entryPath, 'utf8')
  } catch (error) {
    return report({ kind: 'result', ok: false, error: 'Cannot read the plugin entry file: ' + error.message })
  }

  let nextCallId = 1
  const pendingCalls = new Map()

  parentPort.on('message', message => {
    if (!message || message.kind !== 'rpc-result') return
    const pending = pendingCalls.get(message.id)
    if (!pending) return
    pendingCalls.delete(message.id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(typeof message.value === 'string' ? message.value : 'null')
  })

  function callHost(method, argsJson) {
    const id = nextCallId++
    return new Promise(function (resolve, reject) {
      pendingCalls.set(id, { resolve: resolve, reject: reject })
      parentPort.postMessage({ kind: 'rpc', id: id, method: method, args: argsJson })
    })
  }

  const sandbox = {
    __hostCall: callHost,
    __inputsJson: safeStringify(inputs, '{}'),
    __requestJson: safeStringify(request, 'null'),
  }

  let context
  try {
    context = vm.createContext(sandbox, {
      name: 'plugin-' + pluginKey,
      // No new code generation: eval / new Function / WASM compilation all fail right here.
      codeGeneration: { strings: false, wasm: false },
    })
  } catch (error) {
    return report({ kind: 'result', ok: false, error: 'Cannot create the plugin sandbox: ' + error.message })
  }

  let ctx
  try {
    ctx = new vm.Script(CONTEXT_SOURCE, { filename: 'plugin-context.js' }).runInContext(context, { timeout: startupTimeoutMilliseconds })
  } catch (error) {
    return report({ kind: 'result', ok: false, error: 'Cannot build the plugin context: ' + error.message })
  }

  let hooks
  try {
    // The body of the entry file is wrapped into a function; returning the hooks object is the
    // contract (see apps/docs/specs/plugins.md §5).
    // vm's timeout option only stops the synchronous part (a top-level infinite loop) and it covers
    // this script only - a loop inside a hook body runs after the script is done and is stopped by
    // the host calling terminate(). The host arms its own timer one second later than this one, so
    // the two never race: a module-level loop is reported as PLUGIN_RUN_FAILED here, a hung hook as
    // PLUGIN_TIMEOUT from the host.
    hooks = new vm.Script(wrapEntry(code), { filename: entryPath }).runInContext(context, { timeout: timeoutMilliseconds })
  } catch (error) {
    return report({ kind: 'result', ok: false, error: readableError(error) })
  }

  const hook = hooks === null || hooks === undefined ? undefined : hooks[hookName]
  if (typeof hook !== 'function') {
    // The plugin implements the other hook only: a normal shape (the declarative fallback takes
    // over), not a failure.
    return report({ kind: 'result', ok: true, missing: true })
  }

  try {
    const value = await hook(ctx)
    const text = safeStringify(value, null)
    if (text === null) return report({ kind: 'result', ok: false, error: 'The plugin returned a value that cannot be serialized' })
    report({ kind: 'result', ok: true, value: text })
  } catch (error) {
    report({ kind: 'result', ok: false, error: readableError(error) })
  }
}

function report(payload) {
  parentPort.postMessage(payload)
}

function wrapEntry(code) {
  return ['"use strict";', '(function () {', code, '})()'].join('\n')
}

function safeStringify(value, fallback) {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return typeof text === 'string' ? text : fallback
  } catch (error) {
    return fallback
  }
}

function readableError(error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message.indexOf('Script execution timed out') === 0 ? 'The plugin entry ran too long synchronously and was stopped' : error.message
  }
  return String(error)
}

// ctx is built inside the sandbox: even the JSON.parse results live in the plugin's own realm,
// and all the host ever hands over is JSON text.
const CONTEXT_SOURCE = [
  '(function () {',
  '  var call = __hostCall',
  '  var parseJson = function (text) { return JSON.parse(text) }',
  '  var resolved = function () { return undefined }',
  '  var invoke = function (method, args) { return call(method, JSON.stringify(args)) }',
  '  var log = function (level, message) {',
  '    var args = Array.prototype.slice.call(arguments, 1)',
  '    var text = args.length > 1 ? args.map(String).join(" ") : String(message)',
  '    return invoke("log", [level, text]).then(resolved)',
  '  }',
  '  var ctx = {',
  '    inputs: JSON.parse(__inputsJson),',
  '    request: __requestJson === "null" ? undefined : JSON.parse(__requestJson),',
  '    secrets: {',
  '      get: function (name) { return invoke("secret.get", [name]).then(parseJson) },',
  '      set: function (name, value) { return invoke("secret.set", [name, value]).then(resolved) },',
  '      delete: function (name) { return invoke("secret.delete", [name]).then(resolved) }',
  '    },',
  '    storage: {',
  '      get: function (name) { return invoke("storage.get", [name]).then(parseJson) },',
  '      set: function (name, value) { return invoke("storage.set", [name, value]).then(resolved) }',
  '    },',
  '    http: function (request) { return invoke("http", [request]).then(parseJson) },',
  '    log: function (level, message) { return log(level, message) },',
  '    now: function () { return Date.now() }',
  '  }',
  '  // A console shim: any JS developer reaches for console.log first,',
  '  // and it only forwards to ctx.log (no extra capability, see apps/docs/specs/plugins.md §5).',
  '  var console = {',
  '    log: function () { return log.apply(null, ["log"].concat(Array.prototype.slice.call(arguments))) },',
  '    warn: function () { return log.apply(null, ["warn"].concat(Array.prototype.slice.call(arguments))) },',
  '    error: function () { return log.apply(null, ["error"].concat(Array.prototype.slice.call(arguments))) }',
  '  }',
  '  // The shim has to go on the sandbox global: the entry file is a separate script in this',
  '  // context, so a local variable here would be invisible to it (and it would write straight',
  '  // to the worker stdout, which the host never reads).',
  '  globalThis.console = console',
  '  return ctx',
  '})()',
].join('\n')

if (HOOK_NAMES.indexOf(hookName) === -1) {
  report({ kind: 'result', ok: false, error: 'Unsupported plugin hook: ' + String(hookName) })
} else {
  main()
}
`
