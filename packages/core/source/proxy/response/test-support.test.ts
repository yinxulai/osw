import { describe, expect, it } from 'vitest'
import {
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

/**
 * 第二层：审计夹具本身。
 *
 * 健康的生产函数和当前的两份单测必须被放行；分类器、脱敏、上游换钥、
 * 以及第一层用例对夹具的引用，任何一处被写坏都要留下探针编号。
 */
describe('channel safety harness', () => {
  it('accepts the production failover classifier and rejects broken classifiers and case tables', () => {
    const verdict = evaluateFailoverHarness(auditFailoverClassifier)

    expect(verdict.healthyFailures).toEqual([])
    expect(verdict.missedProbeIds).toEqual([])
    expect(verdict.sound).toBe(true)
  })

  it('accepts production header redaction and rejects leaks and rewritten expectations', () => {
    const verdict = evaluateCredentialHarness(auditCredentialRedaction)

    expect(verdict.healthyFailures).toEqual([])
    expect(verdict.missedProbeIds).toEqual([])
    expect(verdict.sound).toBe(true)
  })

  it('accepts production upstream credential swap and rejects forwarded client secrets', () => {
    const verdict = evaluateUpstreamHarness(auditUpstreamCredentialSwap)

    expect(verdict.healthyFailures).toEqual([])
    expect(verdict.missedProbeIds).toEqual([])
    expect(verdict.sound).toBe(true)
  })

  it('accepts the failover and header tests only while they still call this harness', () => {
    const verdict = evaluateLayer1Wiring(auditLayer1Wiring, loadLayer1Sources())

    expect(verdict.healthyFailures).toEqual([])
    expect(verdict.missedProbeIds).toEqual([])
    expect(verdict.sound).toBe(true)
  })
})
