import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_HEADERS,
  UPSTREAM_AUTH,
  UPSTREAM_CLIENT_HEADERS,
  UPSTREAM_CONTENT_LENGTH,
  auditCredentialRedaction,
  auditFailoverClassifier,
  auditLayer1Wiring,
  auditUpstreamCredentialSwap,
  evaluateCredentialHarness,
  evaluateFailoverHarness,
  evaluateLayer1Wiring,
  evaluateUpstreamHarness,
  loadLayer1Sources,
} from './test-support'
import type { AuditReport, FailoverAudit, HeaderRedactor, RedactionAudit, UpstreamAudit, UpstreamHeaderBuilder, WiringAudit } from './test-support'

/**
 * 第三层：第二层的裁决本身。
 *
 * `evaluate*` 在审计健康时必须判 sound，在审计永远放行、永远失败、或漏掉某一类探针时必须判不 sound。
 * 否则第二层会在夹具已经写坏时仍然报绿。
 */

const alwaysGreen = (): AuditReport => ({ ok: true, failures: [] })
const alwaysRed = (): AuditReport => ({ ok: false, failures: ['broken'] })

const ignoresFailoverTables: FailoverAudit = subject => {
  const failures: string[] = []
  if (subject.classifyUpstreamStatus(500) !== 'failover') failures.push('500')
  if (subject.classifyUpstreamStatus(200) !== 'success') failures.push('200')
  return { ok: failures.length === 0, failures }
}

const masksAuthorizationOnly: RedactionAudit = (redact: HeaderRedactor) => {
  const redacted = redact(CREDENTIAL_HEADERS)
  const failures: string[] = []
  if (redacted.authorization !== '[REDACTED]') failures.push('authorization')
  return { ok: failures.length === 0, failures }
}

const rejectsClientBearerOnly: UpstreamAudit = (build: UpstreamHeaderBuilder) => {
  const built = build(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)
  const failures: string[] = []
  if (JSON.stringify(built).includes('client-token')) failures.push('bearer')
  return { ok: failures.length === 0, failures }
}

const checksHeadersOnly: WiringAudit = sources => {
  const failures: string[] = []
  if (!sources.headersTest.includes('redactHeaders(CREDENTIAL_HEADERS)')) failures.push('headers')
  return { ok: failures.length === 0, failures }
}

describe('channel safety meta-harness', () => {
  it('passes the failover evaluator when the audit is healthy', () => {
    expect(evaluateFailoverHarness(auditFailoverClassifier).sound).toBe(true)
  })

  it('fails the failover evaluator when the audit passes everything', () => {
    const verdict = evaluateFailoverHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('auth-failure-blamed-on-client')
    expect(verdict.missedProbeIds).toContain('failover-table-swaps-401-for-418')
    expect(verdict.missedProbeIds).toContain('five-hundred-counted-as-success')
  })

  it('fails the failover evaluator when the audit fails everything', () => {
    const verdict = evaluateFailoverHarness(alwaysRed)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(false)
  })

  it('fails the failover evaluator when the audit ignores client-fault attribution and the case table', () => {
    const verdict = evaluateFailoverHarness(ignoresFailoverTables)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('auth-failure-blamed-on-client')
    expect(verdict.missedProbeIds).toContain('failover-table-swaps-401-for-418')
  })

  it('passes the redaction evaluator when the audit is healthy', () => {
    expect(evaluateCredentialHarness(auditCredentialRedaction).sound).toBe(true)
  })

  it('fails the redaction evaluator when the audit passes everything', () => {
    const verdict = evaluateCredentialHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('leaks-api-key')
    expect(verdict.missedProbeIds).toContain('redacts-content-type')
  })

  it('fails the redaction evaluator when the audit fails everything', () => {
    expect(evaluateCredentialHarness(alwaysRed).healthyPasses).toBe(false)
    expect(evaluateCredentialHarness(alwaysRed).sound).toBe(false)
  })

  it('fails the redaction evaluator when the audit only checks authorization', () => {
    const verdict = evaluateCredentialHarness(masksAuthorizationOnly)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('leaks-api-key')
    expect(verdict.missedProbeIds).toContain('redacts-content-type')
  })

  it('passes the upstream evaluator when the audit is healthy', () => {
    expect(evaluateUpstreamHarness(auditUpstreamCredentialSwap).sound).toBe(true)
  })

  it('fails the upstream evaluator when the audit passes everything', () => {
    const verdict = evaluateUpstreamHarness(alwaysGreen)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('forwards-client-bearer')
    expect(verdict.missedProbeIds).toContain('drops-provider-key')
  })

  it('fails the upstream evaluator when the audit fails everything', () => {
    expect(evaluateUpstreamHarness(alwaysRed).healthyPasses).toBe(false)
    expect(evaluateUpstreamHarness(alwaysRed).sound).toBe(false)
  })

  it('fails the upstream evaluator when the audit only rejects a forwarded bearer', () => {
    const verdict = evaluateUpstreamHarness(rejectsClientBearerOnly)

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('drops-provider-key')
    expect(verdict.missedProbeIds).not.toContain('forwards-client-bearer')
  })

  it('passes the wiring evaluator when the layer-1 tests still call the harness', () => {
    expect(evaluateLayer1Wiring(auditLayer1Wiring, loadLayer1Sources()).sound).toBe(true)
  })

  it('fails the wiring evaluator when the audit passes everything', () => {
    const verdict = evaluateLayer1Wiring(alwaysGreen, loadLayer1Sources())

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('response-test-drops-failover-table')
    expect(verdict.missedProbeIds).toContain('headers-test-drops-credential-fixture')
  })

  it('fails the wiring evaluator when the audit ignores the response tests', () => {
    const verdict = evaluateLayer1Wiring(checksHeadersOnly, loadLayer1Sources())

    expect(verdict.sound).toBe(false)
    expect(verdict.healthyPasses).toBe(true)
    expect(verdict.missedProbeIds).toContain('response-test-drops-failover-table')
  })
})
