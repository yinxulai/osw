import { describe, expect, it } from 'vitest'
import { extractRequestAttributes } from './request-attributes'

function attributes(userAgent: string, extra: Record<string, string> = {}) {
  return Object.fromEntries(extractRequestAttributes({ 'user-agent': userAgent, ...extra }).map(attribute => [attribute.key, attribute.value]))
}

describe('extractRequestAttributes', () => {
  it('parses common browser, operating system and device attributes', () => {
    expect(attributes('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36')).toMatchObject({
      'client.category': 'browser',
      'client.name': 'Chrome',
      'client.version': '128.0',
      'os.name': 'Mac OS',
      'os.version': '10.15',
      'device.type': 'desktop',
    })
  })

  it('keeps unknown clients observable without failing request logging', () => {
    expect(attributes('future-agent/9.1')).toMatchObject({ 'client.category': 'custom', 'client.name': 'future-agent', 'client.version': '9.1' })
    expect(attributes('')).toEqual({ 'client.category': 'unknown' })
  })

  it('captures an explicit source independently from UA parsing', () => {
    expect(attributes('curl/8.0.1', { 'x-one-switch-source': 'build-agent' })).toMatchObject({
      'client.category': 'cli',
      'client.name': 'curl',
      'request.source': 'build-agent',
    })
  })
})
