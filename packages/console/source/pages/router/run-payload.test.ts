import { describe, expect, it } from 'vitest'
import { samplePayload } from '@common/router/presets'
import { initialPayloadText, parseRunPayload, payloadRowsFor } from './run-payload'

const models = [{ modelId: 'model_default', enabled: true }]

describe('run payload', () => {
  it('opens with the sample payload, so the first run needs no typing', () => {
    expect(JSON.parse(initialPayloadText())).toEqual(samplePayload)
  })

  it('grows the input box with its content, within 8..28 rows', () => {
    expect(payloadRowsFor('{}')).toBe(8)
    expect(payloadRowsFor('\n'.repeat(10))).toBe(12)
    expect(payloadRowsFor('\n'.repeat(40))).toBe(28)
  })

  it('injects the current logical models into the payload that actually goes out', () => {
    expect(parseRunPayload('{"input":"hello"}', models)).toEqual({ input: 'hello', logicalModels: models })
  })

  it('treats a payload that is not an object as empty, and still injects the models', () => {
    expect(parseRunPayload('42', models)).toEqual({ logicalModels: models })
    expect(parseRunPayload('null', models)).toEqual({ logicalModels: models })
  })

  it('lets invalid JSON surface as its syntax error instead of guessing a payload', () => {
    expect(() => parseRunPayload('{oops', models)).toThrow(SyntaxError)
  })
})
