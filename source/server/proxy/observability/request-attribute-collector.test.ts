import { describe, expect, it } from 'vitest'
import { collectRequestAttributes, extractClientRequestId } from './request-attribute-collector'

function collectedAttributes(userAgent: string, extra: Record<string, string> = {}) {
  return Object.fromEntries(collectRequestAttributes({ 'user-agent': userAgent, ...extra }).map(attribute => [attribute.key, attribute.value]))
}

describe('collectRequestAttributes', () => {
  it('parses common browser, operating system and device attributes', () => {
    expect(collectedAttributes('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36')).toMatchObject({
      'client.category': 'browser',
      'client.name': 'Chrome',
      'client.version': '128.0',
      'os.name': 'Mac OS',
      'os.version': '10.15',
      'device.type': 'desktop',
    })
  })

  it('keeps unknown clients observable without failing request logging', () => {
    expect(collectedAttributes('future-agent/9.1')).toMatchObject({ 'client.category': 'custom', 'client.name': 'future-agent', 'client.version': '9.1' })
    expect(collectedAttributes('')).toEqual({ 'client.category': 'unknown' })
  })

  it('captures an explicit source independently from UA parsing', () => {
    expect(collectedAttributes('curl/8.0.1', { 'x-one-switch-source': 'build-agent' })).toMatchObject({
      'client.category': 'cli',
      'client.name': 'curl',
      'request.source': 'build-agent',
    })
  })

  it('captures client request id from common headers', () => {
    expect(collectedAttributes('curl/8.0.1', { 'x-ms-client-request-id': 'eeb9e968-272c-4cb2-85d8-f9826e86bd19' })).toMatchObject({
      'request.client_request_id': 'eeb9e968-272c-4cb2-85d8-f9826e86bd19',
    })
    expect(extractClientRequestId({ 'x-client-request-id': 'client-id-123' })).toBe('client-id-123')
    expect(extractClientRequestId({ 'x-request-id': 'request-id-456' })).toBe('request-id-456')
  })
})
