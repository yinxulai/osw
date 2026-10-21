import type { EnvelopeInput, EnvelopeWriteResult, ProtocolEnvelope, ProtocolModelReadResult, TransportKind } from '@server/proxy/contracts'

/** 「请求体必须是 JSON 对象」是模型读写与默认值补齐共用的失败文案。 */
export const JSON_BODY_REQUIRED_MESSAGE = 'The request body must be a JSON object'

/**
 * 解析请求体为 JSON 对象；空体、非法 JSON、非对象都返回 `null`。
 *
 * 允许空体：`/v1/embeddings` 这类接口的探测请求可能没有正文。
 */
export function parseJsonObject(body: Buffer): Record<string, unknown> | null {
  if (body.length === 0) return null
  try {
    const payload: unknown = JSON.parse(body.toString('utf8'))
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从请求体读出模型名。 */
export function readJsonModel(body: Buffer): ProtocolModelReadResult {
  const payload = parseJsonObject(body)
  if (payload === null) return { ok: false, reason: JSON_BODY_REQUIRED_MESSAGE }
  const model = payload.model
  if (model === undefined) return { ok: false, reason: 'Missing the model field' }
  if (typeof model !== 'string' || model.trim().length === 0) return { ok: false, reason: 'The model field must be a non-empty string' }
  return { ok: true, model }
}

/**
 * 把模型名写进请求体，保留其余字段。
 *
 * 空体原样返回；非法 JSON 与非对象体抛错。
 */
export function writeJsonModel(body: Buffer, modelName: string): Buffer {
  if (body.length === 0) return body
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch (error) {
    throw new Error('Request body must be a JSON object', { cause: error })
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Request body must be a JSON object')
  }
  return Buffer.from(JSON.stringify({ ...(payload as Record<string, unknown>), model: modelName }))
}

export interface JsonEnvelopeOptions {
  /**
   * 表示「要求增量交付」的字段名；`null` 表示该接口没有这个概念（例如 embeddings）。
   *
   * 字段名本身就是协议的一部分（OpenAI 系用 `stream`），因此只能由接口声明给出。
   */
  readonly streamingField: string | null
}

/**
 * JSON 封装的协议。
 *
 * 今天三种协议的请求封装形状相同（模型名与传输形态都在 JSON 字段里），所以共用这一个工厂；
 * 将来接入路径携带模型的协议（例如 `/v1beta/models/{model}:generateContent`）时，
 * 新协议写自己的 `ProtocolEnvelope` 即可，内核与执行器不需要任何改动。
 */
export function createJsonEnvelope(options: JsonEnvelopeOptions): ProtocolEnvelope {
  const deliveryModeFields = options.streamingField === null ? [] : [options.streamingField]
  return {
    body: 'json',
    deliveryModeFields,
    readModel(input: EnvelopeInput): ProtocolModelReadResult {
      return readJsonModel(input.body)
    },
    writeModel(input: EnvelopeInput, modelName: string): EnvelopeWriteResult {
      return { body: writeJsonModel(input.body, modelName), url: input.url }
    },
    resolveTransport(input: EnvelopeInput): TransportKind {
      if (options.streamingField === null) return 'http'
      return parseJsonObject(input.body)?.[options.streamingField] === true ? 'http-stream' : 'http'
    },
  }
}
