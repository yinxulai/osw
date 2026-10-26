import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_HEADERS,
  CREDENTIAL_PROBE_IDS,
  FAILOVER_PROBE_IDS,
  UPSTREAM_AUTH,
  UPSTREAM_CLIENT_HEADERS,
  UPSTREAM_CONTENT_LENGTH,
  UPSTREAM_PROBE_IDS,
  auditCredentialRedaction,
  auditFailoverClassifier,
  auditUpstreamCredentialSwap,
  evaluateCredentialHarness,
  evaluateFailoverHarness,
  evaluateUpstreamHarness,
} from './test-support'
import type { AuditReport, FailoverAudit, HeaderRedactor, RedactionAudit, UpstreamAudit, UpstreamHeaderBuilder } from './test-support'

/**
 * 第三层：第二层的裁决本身。
 *
 * `evaluate*` 在审计健康时必须判 sound；在审计永远放行、永远失败、或漏掉某一类探针时
 * 必须判不 sound（并留下**完整**的漏检清单，而不是抽查其中的两三个）。
 */

const sorted = (ids: readonly string[]): string[] => [...ids].sort()

const alwaysGreen = (): AuditReport => ({ ok: true, failures: [] })
const alwaysRed = (): AuditReport => ({ ok: false, failures: ['broken'] })

/** 只验 500 / 200 两个点的审计：区间漂移、归因、白名单它一概看不见。 */
const ignoresFailoverTables: FailoverAudit = subject => {
  const failures: string[] = []
  if (subject.classifyUpstreamStatus(500) !== 'failover') failures.push('500')
  if (subject.classifyUpstreamStatus(200) !== 'success') failures.push('200')
  return { ok: failures.length === 0, failures }
}

/** 只验授权头被遮罩的脱敏审计：其余的泄露与改写它都放行。 */
const masksAuthorizationOnly: RedactionAudit = (redact: HeaderRedactor) => {
  const redacted = redact(CREDENTIAL_HEADERS)
  const failures: string[] = []
  if (redacted.authorization !== '[REDACTED]') failures.push('authorization')
  return { ok: failures.length === 0, failures }
}

/** 只验客户端 bearer 没被转发的上游审计：换钥、丢头、跳跳头它都放行。 */
const rejectsClientBearerOnly: UpstreamAudit = (build: UpstreamHeaderBuilder) => {
  const built = build(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)
  const failures: string[] = []
  if (JSON.stringify(built).includes('client-token')) failures.push('bearer')
  return { ok: failures.length === 0, failures }
}

const MISSED_BY_IGNORES_FAILOVER_TABLES = [
  'shrunken-success-interval',
  'auth-failure-blamed-on-client',
  'rate-limit-blamed-on-client',
  'malformed-request-treated-as-retryable',
]

const MISSED_BY_MASKS_AUTHORIZATION_ONLY = [
  'leaks-api-key',
  'redacts-content-type',
  'ignores-custom-auth-header',
  'fixture-drops-bearer-secret',
  'expectation-stores-bearer',
  'custom-expectation-keeps-key',
]

const MISSED_BY_REJECTS_CLIENT_BEARER_ONLY = [
  'drops-provider-key',
  'drops-accept',
  'forwards-hop-by-hop',
  'fixture-drops-client-bearer',
  'forwarded-expectation-keeps-bearer',
]

describe('channel safety meta-harness', () => {
  it('passes the failover evaluator when the audit is healthy', () => {
    expect(evaluateFailoverHarness(auditFailoverClassifier).sound).toBe(true)
  })

  it('misses every failover probe when the audit passes everything', () => {
    const verdict = evaluateFailoverHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(FAILOVER_PROBE_IDS))
  })

  it('catches every failover probe when the audit fails everything', () => {
    const verdict = evaluateFailoverHarness(alwaysRed)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(false)
    expect(verdict.missedProbeIds).toEqual([])
  })

  it('misses exactly the failover probes a two-point audit cannot see', () => {
    const verdict = evaluateFailoverHarness(ignoresFailoverTables)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(MISSED_BY_IGNORES_FAILOVER_TABLES))
  })

  it('passes the redaction evaluator when the audit is healthy', () => {
    expect(evaluateCredentialHarness(auditCredentialRedaction).sound).toBe(true)
  })

  it('misses every redaction probe when the audit passes everything', () => {
    const verdict = evaluateCredentialHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(CREDENTIAL_PROBE_IDS))
  })

  it('catches every redaction probe when the audit fails everything', () => {
    const verdict = evaluateCredentialHarness(alwaysRed)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(false)
    expect(verdict.missedProbeIds).toEqual([])
  })

  it('misses exactly the redaction probes an authorization-only audit cannot see', () => {
    const verdict = evaluateCredentialHarness(masksAuthorizationOnly)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(MISSED_BY_MASKS_AUTHORIZATION_ONLY))
  })

  it('passes the upstream evaluator when the audit is healthy', () => {
    expect(evaluateUpstreamHarness(auditUpstreamCredentialSwap).sound).toBe(true)
  })

  it('misses every upstream probe when the audit passes everything', () => {
    const verdict = evaluateUpstreamHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(UPSTREAM_PROBE_IDS))
  })

  it('catches every upstream probe when the audit fails everything', () => {
    const verdict = evaluateUpstreamHarness(alwaysRed)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(false)
    expect(verdict.missedProbeIds).toEqual([])
  })

  it('misses exactly the upstream probes a bearer-rejecting audit cannot see', () => {
    const verdict = evaluateUpstreamHarness(rejectsClientBearerOnly)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(sorted(verdict.missedProbeIds)).toEqual(sorted(MISSED_BY_REJECTS_CLIENT_BEARER_ONLY))
  })
})
