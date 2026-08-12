import type { KeychainApi } from '@common/keychain'

let secretStore: KeychainApi | null = null

export function configureSecretStore(store: KeychainApi): void {
  secretStore = store
}

export function getSecretStore(): KeychainApi {
  if (!secretStore) throw new Error('Secret store is not configured')
  return secretStore
}
