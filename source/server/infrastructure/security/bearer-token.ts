import { timingSafeEqual } from 'node:crypto'

export function parseBearerToken(value: string | undefined): string | null {
  if (!value) return null
  const match = /^Bearer ([^\s]+)$/.exec(value)
  return match?.[1] ?? null
}

export function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}
