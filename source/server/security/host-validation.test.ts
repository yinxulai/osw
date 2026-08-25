import { describe, expect, it } from 'vitest'
import { isAllowedHost } from './host-validation'

describe('isAllowedHost', () => {
  it.each([
    'localhost',
    'localhost:9300',
    '127.0.0.1',
    '127.0.0.1:9300',
    '[::1]',
    '[::1]:9300',
  ])('allows loopback host %s', host => {
    expect(isAllowedHost(host, '127.0.0.1', 9300)).toBe(true)
  })

  it('allows the explicitly configured listen host', () => {
    expect(isAllowedHost('192.0.2.10:9300', '192.0.2.10', 9300)).toBe(true)
  })

  it.each([
    undefined,
    '',
    'attacker.example',
    'localhost.attacker.example:9300',
    '127.0.0.1:9301',
    'user@localhost:9300',
    'localhost:9300/path',
  ])('rejects invalid host %s', host => {
    expect(isAllowedHost(host, '127.0.0.1', 9300)).toBe(false)
  })

  it('treats a wildcard listener as an explicit expose-all choice', () => {
    expect(isAllowedHost('0.0.0.0:9300', '0.0.0.0', 9300)).toBe(true)
    expect(isAllowedHost('192.0.2.5:9300', '::', 9300)).toBe(true)
    expect(isAllowedHost('localhost:9300', '0.0.0.0', 9300)).toBe(true)
    expect(isAllowedHost('attacker.example:9300', '0.0.0.0', 9300)).toBe(true)
  })
})
