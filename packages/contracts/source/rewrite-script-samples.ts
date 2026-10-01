import type { UiCatalogKey } from './i18n/catalogs'

/**
 * 脚本动作的示例代码。
 *
 * 目的不是「教 JavaScript」，而是让用户看清三件事：能看到什么（`body` / `headers` /
 * `protocol` / `get`）、要交回什么（**完整**报文）、以及「没交回的字段即删除」这条最容易
 * 踩坑的替换语义。前两条按阶段各给一份「基线」示例，选中脚本时就自动填入，用户改两笔
 * 即可用；其余三条演示更具体的意图（删字段、滤头、条件改写）。
 *
 * **为什么住在 `@common`**：这些字符串是**服务端会执行的代码**的模板（用户点了保存，它就
 * 成为一条真正在沙箱里跑的规则）。放在渲染层里，`@osw/core` 就无法在测试中执行它们，
 * 「所有内置脚本都被真实执行覆盖」这条也就只能停在「能作为函数体解析」这种表面检查上。
 * 与 `@common/router/presets.ts` 同一个理由——凡是要被两侧共同验证的内建内容，都得放在
 * 两侧都够得着的地方。
 *
 * 代码里只有英文注释与标识符：这些字符串会直接进代码编辑器，跟着界面语言翻译会破坏可读
 * 性；名称与说明走 i18n 目录，由下拉展示。
 */

export type RewriteScriptStage = 'request' | 'response'

export interface RewriteScriptSample {
  id: string
  /** 示例作用的报文阶段。它同时决定「这段代码在哪些交付形态下真的会跑」：响应阶段示例
   * 只有非流式（整包）响应才会执行（见 `delivery-shape.ts` 的 `isStageRunnable`）。 */
  stage: RewriteScriptStage
  nameKey: UiCatalogKey
  descriptionKey: UiCatalogKey
  code: string
}

/** 请求阶段基线：交回完整 body 与 headers，顺带把 context 打进测试日志。 */
export const REQUEST_BASELINE_CODE = `// Read the request, change what you need, then return the whole payload back.
// body / headers / protocol are read-only; use get('path') to read a nested value.
// Returning { body, headers } replaces them entirely: a field you leave out is deleted.
console.log('stage', protocol.stage, protocol.clientProtocol, '->', protocol.upstreamProtocol)
return {
  body: { ...body, temperature: 0 },
  headers: { ...headers },
}
`

/** 响应阶段基线：上游返回的 JSON 与响应头。 */
export const RESPONSE_BASELINE_CODE = `// Read the upstream response, change what you need, then return the whole payload back.
// body is the parsed JSON response; headers are the upstream response headers.
// Returning { body, headers } replaces them entirely: a key you leave out is deleted.
console.log('response', body && body.id)
return {
  body: { ...body, id: 'rw-' + ((body && body.id) || '') },
  headers: { ...headers },
}
`

/** 删字段：解构丢掉目标键，其余原样交回。 */
export const DROP_BODY_FIELD_CODE = `// Remove a field: return the whole body with that key left out.
// Because the returned body replaces the current one, \`metadata\` is gone for good.
const { metadata, ...rest } = body || {}
return { body: rest, headers: { ...headers } }
`

/** 滤头：头名大小写不固定，按小写比对后再决定去留。 */
export const FILTER_HEADERS_CODE = `// Drop some headers: anything you do not return back is deleted.
const drop = ['x-debug', 'x-internal-trace']
const kept = {}
for (const name of Object.keys(headers)) {
  if (drop.indexOf(name.toLowerCase()) === -1) kept[name] = headers[name]
}
return { headers: kept }
`

/** 条件改写：不 `return` 就是「这一条动作不改动」。 */
export const CONDITIONAL_CODE = `// Only rewrite when the body mentions "apply-strict"; otherwise leave it untouched.
if (body && JSON.stringify(body).indexOf('apply-strict') !== -1) {
  console.log('strict marker found, forcing temperature to 0')
  return { body: { ...body, temperature: 0 } }
}
`

/**
 * 「写一段脚本」规则模板自带的脚本。
 *
 * 它演示的是结构化动作表达不了的那件事——先看内容，再决定这条规则要不要动手；没命中
 * 就什么都不做（不 `return` 即整条不改动）。
 *
 * 与示例放在同一份文件、同一个理由：它是**会被真正执行**的代码，必须能被 `@osw/core`
 * 的测试拿到并跑一遍。模板里只引用这个常量，不在渲染层另写一份，免得「用户拿到的脚本」
 * 与「测试跑过的脚本」变成两段漂移的文本。
 */
export const PRESET_CONDITIONAL_SCRIPT_CODE = `// Rewrite only when this request asks for strict mode; otherwise do nothing.
// Returning nothing leaves the payload untouched, so this rule stays out of the way.
const marker = JSON.stringify(body || {})
if (marker.indexOf('apply-strict') === -1) {
  console.log('not a strict request, skipping')
} else {
  console.log('forcing temperature to 0')
  return { body: { ...body, temperature: 0 }, headers: { ...headers } }
}
`

export const REWRITE_SCRIPT_SAMPLES: readonly RewriteScriptSample[] = [
  {
    id: 'request-baseline',
    stage: 'request',
    nameKey: 'rules.script.samples.requestBaseline.name',
    descriptionKey: 'rules.script.samples.requestBaseline.description',
    code: REQUEST_BASELINE_CODE,
  },
  {
    id: 'response-baseline',
    stage: 'response',
    nameKey: 'rules.script.samples.responseBaseline.name',
    descriptionKey: 'rules.script.samples.responseBaseline.description',
    code: RESPONSE_BASELINE_CODE,
  },
  {
    id: 'drop-body-field',
    stage: 'request',
    nameKey: 'rules.script.samples.dropField.name',
    descriptionKey: 'rules.script.samples.dropField.description',
    code: DROP_BODY_FIELD_CODE,
  },
  {
    id: 'filter-headers',
    stage: 'request',
    nameKey: 'rules.script.samples.headerFilter.name',
    descriptionKey: 'rules.script.samples.headerFilter.description',
    code: FILTER_HEADERS_CODE,
  },
  {
    id: 'conditional',
    stage: 'request',
    nameKey: 'rules.script.samples.conditional.name',
    descriptionKey: 'rules.script.samples.conditional.description',
    code: CONDITIONAL_CODE,
  },
]

/** 选中脚本目标时自动填入的起始脚本：请求阶段用请求基线，响应阶段用响应基线。 */
export function defaultRewriteScript(stage: RewriteScriptStage): string {
  return stage === 'response' ? RESPONSE_BASELINE_CODE : REQUEST_BASELINE_CODE
}
