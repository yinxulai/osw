import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { en } from './i18n'

const SOURCE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url))

function collectSourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      found.push(...collectSourceFiles(fullPath))
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(fullPath)
  }
  return found
}

function flattenKeys(value: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') keys.push(fullKey)
    else if (child && typeof child === 'object') {
      keys.push(...flattenKeys(child as Record<string, unknown>, fullKey))
    }
  }
  return keys
}

function collectStaticTranslationKeys(): Set<string> {
  const keys = new Set<string>()

  for (const file of collectSourceFiles(SOURCE_DIRECTORY)) {
    const source = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node)
        && node.expression.getText(sourceFile) === 't'
        && node.arguments[0]
        && ts.isStringLiteral(node.arguments[0])
      ) {
        keys.add(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return keys
}

/**
 * 动态 key 的取值来自组件内的数据表，AST 无法单靠 `t()` 参数推出全集。
 * 这里逐个列出目前存在的动态分支，值集变化时测试会立即暴露缺失的英文资源。
 */
const DYNAMIC_TRANSLATION_KEYS = [
  'capabilities.routing.title',
  'capabilities.routing.body',
  'capabilities.routing.p1',
  'capabilities.routing.p2',
  'capabilities.routing.p3',
  'capabilities.routing.p4',
  'capabilities.observability.title',
  'capabilities.observability.body',
  'capabilities.observability.p1',
  'capabilities.observability.p2',
  'capabilities.observability.p3',
  'capabilities.protocol.title',
  'capabilities.protocol.body',
  'capabilities.protocol.p1',
  'capabilities.protocol.p2',
  'capabilities.protocol.p3',
  'failover.rule.network.trigger',
  'failover.rule.network.note',
  'failover.rule.auth.trigger',
  'failover.rule.auth.note',
  'failover.rule.pressure.trigger',
  'failover.rule.pressure.note',
  'failover.rule.server.trigger',
  'failover.rule.server.note',
  'failover.rule.client.trigger',
  'failover.rule.client.note',
  'failover.rule.stream.trigger',
  'failover.rule.stream.note',
  'failover.verdict.switch',
  'failover.verdict.pass',
  'failover.verdict.abort',
  'privacy.listener.title',
  'privacy.listener.body',
  'privacy.keys.title',
  'privacy.keys.body',
  'privacy.upstream.title',
  'privacy.upstream.body',
  'privacy.telemetry.title',
  'privacy.telemetry.body',
  'screenshots.logicalModels.title',
  'screenshots.logicalModels.caption',
  'screenshots.smartRouting.title',
  'screenshots.smartRouting.caption',
  'screenshots.requestLogs.title',
  'screenshots.requestLogs.caption',
  'screenshots.requestRewrite.title',
  'screenshots.requestRewrite.caption',
  'screenshots.analytics.title',
  'screenshots.analytics.caption',
  'screenshots.clientConfig.title',
  'screenshots.clientConfig.caption',
  'nav.screenshots',
  'nav.capabilities',
  'nav.failover',
  'nav.privacy',
  'nav.downloads',
] as const

describe('官网 i18n', () => {
  it('静态 t() key 都有英文资源', () => {
    const available = new Set(flattenKeys(en))
    const missing = [...collectStaticTranslationKeys()].filter(key => !available.has(key))
    expect(missing).toEqual([])
  })

  it('动态 key 分组都有英文资源', () => {
    const available = new Set(flattenKeys(en))
    const missing = DYNAMIC_TRANSLATION_KEYS.filter(key => !available.has(key))
    expect(missing).toEqual([])
  })
})
