import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { telemetryRoutes } from './routes/operations/telemetry'
import { mockResponse } from './test-support'

/**
 * 接口层要证明的就两件事：预览是只读的、报表**静默**接受或丢弃。
 *
 * 校验对象是去掉信封字段之后的事件形状，所以这里的用例同时也是
 * `parseTelemetryEventInput` 的守卫：少一条事件、多一个字段都要看得见。
 */

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

const GET_REQUEST = { method: 'GET' } as unknown as IncomingMessage

/** 一份覆盖全部事件名的合法输入：派生出来的联合少接一个事件，这里就会红。 */
const VALID_INPUTS: TelemetryEventInput[] = [
  { name: 'app_started' },
  { name: 'service_start_failed', reason: 'port' },
  { name: 'telemetry_toggled', enabled: true },
  { name: 'onboarding_finished', skipped: false },
  { name: 'route_mode_changed', mode: 'rules' },
  { name: 'provider_created', kind: 'custom' },
  { name: 'model_added', protocol: 'openai-completions' },
  { name: 'provider_test_run', result: 'failed' },
  { name: 'rewrite_rule_created', kind: 'builtin' },
  { name: 'protocol_conversion_used', from: 'openai-completions', to: 'anthropic-messages' },
  { name: 'failover_happened', attempts: '2' },
  { name: 'workflow_node_run', nodeKind: 'condition' },
  { name: 'logs_exported', withContent: true },
]

describe('telemetry preview route', () => {
  it('answers with the preview shape even before telemetry ever started', async () => {
    const response = mockResponse()

    await telemetryRoutes.invoke('/api/telemetry/preview', response, {}, GET_REQUEST)

    const payload = responseData(response)
    expect(payload.success).toBe(true)
    // 「没在跑」也要把端点、标识位、样例这些字段摆全，界面不靠字段有没有来分支。
    expect(payload.data).toMatchObject({ enabled: false, running: false, installId: null, events: [], source: 'sample' })
    expect((payload.data as { endpoint: string }).endpoint).toMatch(/^https:\/\//)
  })
})

describe('telemetry report route', () => {
  it('accepts every event of the union', async () => {
    for (const input of VALID_INPUTS) {
      const response = mockResponse()

      await telemetryRoutes.invoke('/api/telemetry/report', response, input)

      expect(responseData(response), input.name).toMatchObject({ success: true, data: { accepted: true } })
    }
  })

  it('accepts only the write-side half of an event', async () => {
    // 信封字段由 core 补，界面根本填不了——「客户端伪造 installId / version」在这里就不成立。
    const response = mockResponse()

    await telemetryRoutes.invoke('/api/telemetry/report', response, {
      name: 'app_started',
      installId: '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
    })

    expect(responseData(response)).toMatchObject({ success: true, data: { accepted: false } })
  })

  it('drops an unknown event name without failing the request', async () => {
    // 统计不是业务写入：非法事件静默丢弃，照样回 200，否则一条无所谓的数据会变成用户的问题。
    const response = mockResponse()

    await telemetryRoutes.invoke('/api/telemetry/report', response, { name: 'totally_made_up' })

    expect(responseData(response)).toMatchObject({ success: true, data: { accepted: false } })
  })

  it('drops an event that is missing its own field', async () => {
    const response = mockResponse()

    await telemetryRoutes.invoke('/api/telemetry/report', response, { name: 'onboarding_finished' })

    expect(responseData(response)).toMatchObject({ success: true, data: { accepted: false } })
  })

  it('drops a payload that is not an object at all', async () => {
    for (const body of [null, 'app_started', 42, []]) {
      const response = mockResponse()

      await telemetryRoutes.invoke('/api/telemetry/report', response, body)

      expect(responseData(response)).toMatchObject({ success: true, data: { accepted: false } })
    }
  })
})
