import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 脚本动作的示例代码。
 *
 * 目的不是「教 JavaScript」，而是让用户看清三件事：能看到什么（`body` / `headers` /
 * `protocol` / `get`）、要交回什么（**完整**报文）、以及「没交回的字段即删除」这条最容易
 * 踩坑的替换语义。前两条按阶段各给一份「基线」示例，选中脚本时就自动填入，用户改两笔即可用；
 * 其余三条演示更具体的意图（删字段、滤头、条件改写）。
 *
 * 代码里只有英文注释与标识符：这些字符串会直接进代码编辑器，跟着界面语言翻译会破坏可读性；
 * 名称与说明走 i18n 目录，由下拉展示。
 */

export type RewriteScriptStage = 'request' | 'response'

export interface RewriteScriptSample {
  id: string
  nameKey: UiCatalogKey
  descriptionKey: UiCatalogKey
  code: string
}

/** 请求阶段基线：交回完整 body 与 headers，顺带把 context 打进测试日志。 */
const REQUEST_BASELINE_CODE = `// Read the request, change what you need, then return the whole payload back.
// body / headers / protocol are read-only; use get('path') to read a nested value.
// Returning { body, headers } replaces them entirely: a field you leave out is deleted.
console.log('stage', protocol.stage, protocol.clientProtocol, '->', protocol.upstreamProtocol)
return {
  body: { ...body, temperature: 0 },
  headers: { ...headers },
}
`

/** 响应阶段基线：上游返回的 JSON 与响应头。 */
const RESPONSE_BASELINE_CODE = `// Read the upstream response, change what you need, then return the whole payload back.
// body is the parsed JSON response; headers are the upstream response headers.
// Returning { body, headers } replaces them entirely: a key you leave out is deleted.
console.log('response', body && body.id)
return {
  body: { ...body, id: 'rw-' + ((body && body.id) || '') },
  headers: { ...headers },
}
`

export const REWRITE_SCRIPT_SAMPLES: readonly RewriteScriptSample[] = [
  {
    id: 'request-baseline',
    nameKey: 'rules.script.samples.requestBaseline.name',
    descriptionKey: 'rules.script.samples.requestBaseline.description',
    code: REQUEST_BASELINE_CODE,
  },
  {
    id: 'response-baseline',
    nameKey: 'rules.script.samples.responseBaseline.name',
    descriptionKey: 'rules.script.samples.responseBaseline.description',
    code: RESPONSE_BASELINE_CODE,
  },
  {
    id: 'drop-body-field',
    nameKey: 'rules.script.samples.dropField.name',
    descriptionKey: 'rules.script.samples.dropField.description',
    // 删字段只有在「交回完整 body」时才成立：解构丢掉目标键，其余原样交回。
    code: `// Remove a field: return the whole body with that key left out.
// Because the returned body replaces the current one, \`metadata\` is gone for good.
const { metadata, ...rest } = body || {}
return { body: rest, headers: { ...headers } }
`,
  },
  {
    id: 'filter-headers',
    nameKey: 'rules.script.samples.headerFilter.name',
    descriptionKey: 'rules.script.samples.headerFilter.description',
    // 头名大小写不固定，按小写比对后再决定去留。
    code: `// Drop some headers: anything you do not return back is deleted.
const drop = ['x-debug', 'x-internal-trace']
const kept = {}
for (const name of Object.keys(headers)) {
  if (drop.indexOf(name.toLowerCase()) === -1) kept[name] = headers[name]
}
return { headers: kept }
`,
  },
  {
    id: 'conditional',
    nameKey: 'rules.script.samples.conditional.name',
    descriptionKey: 'rules.script.samples.conditional.description',
    // 不 return 就是「这一条动作不改动」，结构化动作表达不了这种「按内容决定改不改」。
    code: `// Only rewrite when the body mentions "apply-strict"; otherwise leave it untouched.
if (body && JSON.stringify(body).indexOf('apply-strict') !== -1) {
  console.log('strict marker found, forcing temperature to 0')
  return { body: { ...body, temperature: 0 } }
}
`,
  },
]

/** 选中脚本目标时自动填入的起始脚本：请求阶段用请求基线，响应阶段用响应基线。 */
export function defaultRewriteScript(stage: RewriteScriptStage): string {
  return stage === 'response' ? RESPONSE_BASELINE_CODE : REQUEST_BASELINE_CODE
}
