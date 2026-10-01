import type { UiCatalogKey } from './i18n/catalogs'

/**
 * 脚本动作的示例代码。
 *
 * 目的不是「教 JavaScript」，而是让用户看清四件事：能看到什么（`body` / `headers` /
 * `protocol` / `get`）、要交回什么（**完整**报文）、「没交回的字段即删除」这条最容易踩坑的
 * 替换语义、以及「不 `return` 即整条不改动」这条条件分支。示例少而准，每一条都同时承担
 * 文档与模板两个角色。
 *
 * **三个阶段各三条，且阶段互不重叠**：请求侧是基线 / 删字段 / 条件改写，响应侧是基线 /
 * 清理推理字段 / 条件改写。选择示例的下拉会按当前动作的阶段过滤（请求脚本只列请求示例），
 * 因此每条示例都以「它自己那个阶段」为主语写，不做跨阶段假设。
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

/** 请求阶段基线：交回完整 body 与 headers，顺带把协议上下文打进测试日志。 */
export const REQUEST_BASELINE_CODE = `// Starting point for a request script: read the request, change what you need,
// then hand the whole payload back.
// body / headers / protocol are read-only; get('path') reads a nested value.
// What you return replaces the current value entirely: a key you leave out is deleted.
console.log(protocol.stage, protocol.clientProtocol, '->', protocol.upstreamProtocol)
return {
  body: { ...body, temperature: 0 },
  headers: { ...headers },
}
`

/** 响应阶段基线：上游返回的解析后 JSON 与响应头。 */
export const RESPONSE_BASELINE_CODE = `// Starting point for a response script: read the upstream response, change what
// you need, then hand the whole payload back.
// body is the parsed JSON response, headers are the upstream response headers.
// What you return replaces the current value entirely: a key you leave out is deleted.
const id = get('id')
console.log('response id', id)
return {
  body: { ...body, id: 'rw-' + (id || '') },
  headers: { ...headers },
}
`

/**
 * 删字段（请求）：解构丢掉目标键，其余原样交回。
 *
 * 选 `messages` 作示例而不是随手一个键：它是请求体里最容易被中间层塞进私有字段的地方，
 * 而省略即删除正是结构化动作里的 `remove` 表达不出来的能力。
 */
export const DROP_BODY_FIELD_CODE = `// Removing a field: return the whole body with that key left out.
// The returned body replaces the current one, so the key is genuinely gone.
const { messages, ...rest } = body || {}
return { body: rest, headers: { ...headers } }
`

/** 清理推理字段（响应）：把 `choices[*].message.reasoning_content` 从回复里摘掉。 */
export const STRIP_REASONING_CODE = `// Cleaning a response: drop reasoning_content from every choice message
// (DeepSeek / vLLM-style reasoning). Everything you leave out of the
// returned body is deleted, so \`reasoning_content\` disappears for good.
const choices = get('choices')
if (Array.isArray(choices)) {
  const cleaned = choices.map(function (choice) {
    if (!choice || !choice.message) return choice
    const { reasoning_content, ...message } = choice.message
    return { ...choice, message }
  })
  return { body: { ...body, choices: cleaned } }
}
console.log('no choices to clean')
`

/** 请求阶段条件改写：不 `return` 就是「这一条动作不改动」。 */
export const CONDITIONAL_REQUEST_CODE = `// Condition: only rewrite a request that mentions "apply-strict";
// returning nothing at all leaves the payload untouched.
if (JSON.stringify(body || {}).indexOf('apply-strict') !== -1) {
  console.log('strict request, forcing temperature to 0')
  return { body: { ...body, temperature: 0 }, headers: { ...headers } }
}
`

/** 响应阶段条件改写：错误响应原样放行，只改写成功响应。 */
export const CONDITIONAL_RESPONSE_CODE = `// Condition on the response: pass a failed one through untouched and only
// stamp a successful one; returning nothing leaves the payload unchanged.
if (body && body.error === undefined) {
  console.log('successful response, stamping id')
  return { body: { ...body, id: 'rw-' + (body.id || '') }, headers: { ...headers } }
}
console.log('error response, leaving it alone')
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

/**
 * 内置示例，**按阶段成对、不再有跨阶段条目**。
 *
 * 顺序即下拉里的展示顺序：三条请求示例在前、三条响应示例在后，各自「基线 → 具体意图 →
 * 条件分支」依次展开。选择示例的下拉会按当前动作阶段过滤，所以这个顺序只在「同一阶段内」
 * 有意义。
 */
export const REWRITE_SCRIPT_SAMPLES: readonly RewriteScriptSample[] = [
  {
    id: 'request-baseline',
    stage: 'request',
    nameKey: 'rules.script.samples.requestBaseline.name',
    descriptionKey: 'rules.script.samples.requestBaseline.description',
    code: REQUEST_BASELINE_CODE,
  },
  {
    id: 'drop-body-field',
    stage: 'request',
    nameKey: 'rules.script.samples.dropField.name',
    descriptionKey: 'rules.script.samples.dropField.description',
    code: DROP_BODY_FIELD_CODE,
  },
  {
    id: 'conditional-request',
    stage: 'request',
    nameKey: 'rules.script.samples.conditionalRequest.name',
    descriptionKey: 'rules.script.samples.conditionalRequest.description',
    code: CONDITIONAL_REQUEST_CODE,
  },
  {
    id: 'response-baseline',
    stage: 'response',
    nameKey: 'rules.script.samples.responseBaseline.name',
    descriptionKey: 'rules.script.samples.responseBaseline.description',
    code: RESPONSE_BASELINE_CODE,
  },
  {
    id: 'strip-reasoning',
    stage: 'response',
    nameKey: 'rules.script.samples.stripReasoning.name',
    descriptionKey: 'rules.script.samples.stripReasoning.description',
    code: STRIP_REASONING_CODE,
  },
  {
    id: 'conditional-response',
    stage: 'response',
    nameKey: 'rules.script.samples.conditionalResponse.name',
    descriptionKey: 'rules.script.samples.conditionalResponse.description',
    code: CONDITIONAL_RESPONSE_CODE,
  },
]

/** 当前动作阶段可选的示例。下拉只列这一阶段能跑的那几条，避免选了响应示例却卡在请求脚本里。 */
export function rewriteScriptSamplesForStage(stage: RewriteScriptStage): readonly RewriteScriptSample[] {
  return REWRITE_SCRIPT_SAMPLES.filter(sample => sample.stage === stage)
}

/** 选中脚本目标时自动填入的起始脚本：请求阶段用请求基线，响应阶段用响应基线。 */
export function defaultRewriteScript(stage: RewriteScriptStage): string {
  return stage === 'response' ? RESPONSE_BASELINE_CODE : REQUEST_BASELINE_CODE
}

/**
 * 切换报文阶段时，是否应该把编辑器里的脚本换成新阶段的起始脚本。
 *
 * 只在「编辑器里仍是**原阶段的默认基线**」时为真——那说明用户还没动过它，换掉是净收益；
 * 一旦他改过一笔，那几笔就是他的劳动，切换阶段不能把它冲掉。请求基线与响应基线读的是两份
 * 不一样的报文（一个 `body` 是请求、一个 `body` 是上游响应），所以从请求切到响应还留着请求
 * 基线，等于给了个跑不通的起点。
 */
export function shouldReseedScript(code: string | undefined, from: RewriteScriptStage, to: RewriteScriptStage): boolean {
  return from !== to && code === defaultRewriteScript(from)
}
