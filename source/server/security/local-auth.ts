import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { generateKeyReference } from '@common/keychain'
import { getSettings, updateSettings } from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'

export interface LocalAuthStatus {
  enabled: boolean
}

export async function getLocalAuthStatus(): Promise<LocalAuthStatus> {
  const settings = await getSettings()
  return { enabled: settings.accessTokenReference !== null }
}

export async function authorizeLocalRequest(headers: IncomingHttpHeaders): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.accessTokenReference) return true

  const storedToken = await getSecretStore().get(settings.accessTokenReference)
  const suppliedToken = parseBearerToken(headers.authorization)
  if (!storedToken || !suppliedToken) return false
  return constantTimeEqual(storedToken, suppliedToken)
}

export async function generateLocalAccessToken(): Promise<string> {
  const settings = await getSettings()
  if (settings.accessTokenReference) throw new Error('local access token is already enabled')

  const reference = generateKeyReference('local_access_')
  const token = createToken()
  await getSecretStore().set(reference, token)
  try {
    await updateSettings({ accessTokenReference: reference })
  } catch (error) {
    await getSecretStore().delete(reference)
    throw error
  }
  return token
}

export async function rotateLocalAccessToken(): Promise<string> {
  const settings = await getSettings()
  if (!settings.accessTokenReference) throw new Error('local access token is not enabled')
  const token = createToken()
  await getSecretStore().set(settings.accessTokenReference, token)
  return token
}

export async function deleteLocalAccessToken(): Promise<void> {
  const settings = await getSettings()
  if (!settings.accessTokenReference) return
  await getSecretStore().delete(settings.accessTokenReference)
  await updateSettings({ accessTokenReference: null })
}

function createToken(): string {
  return randomBytes(32).toString('base64url')
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) return null
  const match = /^Bearer ([^\s]+)$/.exec(value)
  return match?.[1] ?? null
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}
