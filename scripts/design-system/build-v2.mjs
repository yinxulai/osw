#!/usr/bin/env node
/**
 * 生成 v2 设计系统四份产物：
 *   docs/design-system/tokens.v2.css
 *   docs/design-system/index.html
 *   docs/design-system/README.md
 *   docs/design-system/v2.generated.json
 *
 * `--check` 只校验不落盘，守卫测试用它证明“页面/文档没有偷偷手改”。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildData } from './v2/data.mjs'
import { renderCss } from './v2/render-css.mjs'
import { renderHtml } from './v2/render-html.mjs'
import { renderMarkdown } from './v2/render-md.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DOCS = path.join(ROOT, 'docs/design-system')

const data = buildData(ROOT)
const css = renderCss(data)
data.__tokensCss = css
const html = renderHtml(data).replace(/[ \t]+$/gm, '')
const markdown = renderMarkdown(data).replace(/[ \t]+$/gm, '')
const json = `${JSON.stringify({ ...data, __tokensCss: undefined, v1Colors: undefined, v1Contrast: undefined }, null, 2)}\n`

const outputs = [
  { key: 'css', file: path.join(DOCS, 'tokens.v2.css'), content: css },
  { key: 'html', file: path.join(DOCS, 'index.html'), content: html },
  { key: 'readme', file: path.join(DOCS, 'README.md'), content: markdown },
  { key: 'json', file: path.join(DOCS, 'v2.generated.json'), content: json },
]

const changed = {}
for (const item of outputs) {
  changed[item.key] = !fs.existsSync(item.file) || fs.readFileSync(item.file, 'utf8') !== item.content
}

const checkOnly = process.argv.includes('--check')
if (checkOnly) {
  for (const item of outputs) {
    if (changed[item.key]) console.error(`${path.relative(ROOT, item.file)} 与数据不一致：请重新运行 node scripts/design-system/build-v2.mjs`)
  }
} else {
  fs.mkdirSync(DOCS, { recursive: true })
  for (const item of outputs) {
    if (changed[item.key]) fs.writeFileSync(item.file, item.content)
  }
}

const report = {
  mode: checkOnly ? 'check' : 'write',
  changed,
  counts: data.meta.counts,
  requiredPairs: [...data.contrast.light, ...data.contrast.dark].filter(item => item.threshold !== null).length,
  failingPairs: [...data.contrast.light, ...data.contrast.dark].filter(item => item.threshold !== null && item.pass === false).map(item => `${item.id}/${item.fgHex}/${item.bgHex}/${item.ratio}`),
}

console.log(JSON.stringify(report, null, 2))
if (checkOnly && Object.values(changed).some(Boolean)) process.exitCode = 1
