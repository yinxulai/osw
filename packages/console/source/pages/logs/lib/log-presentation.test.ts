import { describe, expect, it } from 'vitest'
import { ALL_LOG_SCOPES } from '@common/schemas'
import { CATALOGS } from '@common/i18n/catalogs'
import { LOG_LEVEL_META, LOG_SCOPE_LABEL_KEY, formatLogTimestamp } from './log-presentation'

describe('formatLogTimestamp', () => {
  it('matches a same-options Intl formatter (no hard-coded timezone)', () => {
    const timestamp = 1_700_000_000_000
    const expected = new Intl.DateTimeFormat('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    }).format(timestamp)
    expect(formatLogTimestamp(timestamp, 'zh-CN')).toBe(expected)
  })
})

describe('LOG_LEVEL_META', () => {
  it('covers every level with a label, badge and accent', () => {
    for (const level of ['error', 'warn', 'info', 'log', 'debug'] as const) {
      const meta = LOG_LEVEL_META[level]
      expect(meta.label).toBe(level.toUpperCase())
      expect(meta.badgeClass).toBeTruthy()
      expect(meta.accentClass).toContain('border-l')
    }
  })
})

describe('LOG_SCOPE_LABEL_KEY', () => {
  it('maps every scope to a key that resolves in both catalogs', () => {
    for (const scope of ALL_LOG_SCOPES) {
      const key = LOG_SCOPE_LABEL_KEY[scope]
      expect(key).toBeTruthy()
      expect(CATALOGS['zh-CN'][key]).toBeTruthy()
      expect(CATALOGS.en[key]).toBeTruthy()
    }
  })
})
