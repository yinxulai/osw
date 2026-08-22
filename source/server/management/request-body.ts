import type { IncomingMessage } from 'node:http'
import { AppError } from '../errors'

export async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', chunk => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new AppError('INVALID_JSON', 400, '请求体不是有效 JSON', { cause: error }))
      }
    })
    req.on('aborted', () => fail(new Error('CLIENT_REQUEST_ABORTED')))
    req.on('error', error => fail(error))
  })
}
