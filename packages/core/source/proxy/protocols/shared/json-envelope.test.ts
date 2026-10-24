import { describe, expect, it } from 'vitest'
import { createJsonEnvelope, readJsonModel, writeJsonModel } from './json-envelope'

function envelopeInput(body: string) {
  return { headers: {}, body: Buffer.from(body), url: new URL('http://localhost/v1/chat/completions') }
}

describe('readJsonModel', () => {
  it('reads a non-empty model name', () => {
    expect(readJsonModel(Buffer.from(JSON.stringify({ model: 'gpt-x' })))).toEqual({ ok: true, model: 'gpt-x' })
  })

  it('reports why the model cannot be read', () => {
    expect(readJsonModel(Buffer.from('{'))).toEqual({ ok: false, reason: 'The request body must be a JSON object' })
    expect(readJsonModel(Buffer.from('[]'))).toEqual({ ok: false, reason: 'The request body must be a JSON object' })
    expect(readJsonModel(Buffer.alloc(0))).toEqual({ ok: false, reason: 'The request body must be a JSON object' })
    expect(readJsonModel(Buffer.from(JSON.stringify({ input: 'hello' })))).toEqual({ ok: false, reason: 'Missing the model field' })
    expect(readJsonModel(Buffer.from(JSON.stringify({ model: 42 })))).toEqual({ ok: false, reason: 'The model field must be a non-empty string' })
    expect(readJsonModel(Buffer.from(JSON.stringify({ model: '   ' })))).toEqual({ ok: false, reason: 'The model field must be a non-empty string' })
  })
})

describe('writeJsonModel', () => {
  it('replaces model while preserving the remaining JSON payload', () => {
    const body = Buffer.from(JSON.stringify({ model: 'client-model', stream: true, messages: [] }))

    const result = JSON.parse(writeJsonModel(body, 'provider-model').toString('utf8'))

    expect(result).toEqual({ model: 'provider-model', stream: true, messages: [] })
  })

  it('adds model when the client omitted it', () => {
    const body = Buffer.from(JSON.stringify({ input: 'hello' }))

    const result = JSON.parse(writeJsonModel(body, 'embedding-model').toString('utf8'))

    expect(result).toEqual({ input: 'hello', model: 'embedding-model' })
  })

  it('keeps an empty body unchanged', () => {
    expect(writeJsonModel(Buffer.alloc(0), 'provider-model')).toEqual(Buffer.alloc(0))
  })

  it('rejects malformed or non-object JSON bodies', () => {
    expect(() => writeJsonModel(Buffer.from('{'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
    expect(() => writeJsonModel(Buffer.from('[]'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
  })
})

describe('createJsonEnvelope', () => {
  const envelope = createJsonEnvelope({ streamingField: 'stream' })

  it('reads and writes the model through the body', () => {
    const input = envelopeInput(JSON.stringify({ model: 'client-model', stream: true }))

    expect(envelope.readModel(input)).toEqual({ ok: true, model: 'client-model' })
    const written = envelope.writeModel(input, 'provider-model')
    expect(JSON.parse(written.body.toString('utf8'))).toEqual({ model: 'provider-model', stream: true })
    expect(written.url).toEqual(input.url)
  })

  it('resolves the transport from the declared field only', () => {
    expect(envelope.resolveTransport(envelopeInput(JSON.stringify({ stream: true })))).toBe('http-stream')
    expect(envelope.resolveTransport(envelopeInput(JSON.stringify({ stream: 'true' })))).toBe('http')
    expect(envelope.resolveTransport(envelopeInput(JSON.stringify({ stream: 1 })))).toBe('http')
    expect(envelope.resolveTransport(envelopeInput(JSON.stringify({})))).toBe('http')
    expect(envelope.resolveTransport(envelopeInput('{'))).toBe('http')
  })

  it('exposes the delivery-mode field as protocol metadata, not as a hardcoded engine rule', () => {
    expect(envelope.deliveryModeFields).toEqual(['stream'])
    expect(createJsonEnvelope({ streamingField: null }).deliveryModeFields).toEqual([])
  })

  it('has no incremental transport when the field is null', () => {
    const embeddings = createJsonEnvelope({ streamingField: null })
    expect(embeddings.resolveTransport(envelopeInput(JSON.stringify({ stream: true })))).toBe('http')
  })
})
