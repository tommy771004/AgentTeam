/** Production adapter binding integration credentials to Electron safeStorage. */

import {
  clearVaultSecret,
  getVaultSecret,
  isVaultEncryptionAvailable,
  listVaultMeta,
  setVaultSecret,
} from './secretsVault'
import {
  createCredentialVaultAuthority,
  type CredentialRef,
  type CredentialVaultIntent,
} from './credentialVaultAuthority'

const authority = createCredentialVaultAuthority({
  secureStorageAvailable: isVaultEncryptionAvailable,
  list: () => listVaultMeta().map((meta) => ({ ref: meta.id, ...meta })),
  readForUse: (ref) => getVaultSecret(ref)?.token || null,
  store: (ref, secret) => {
    const meta = setVaultSecret(ref, secret)
    return { ref: meta.id, ...meta }
  },
  clear: clearVaultSecret,
})

export function handleCredentialVaultIntent(intent: CredentialVaultIntent) {
  return authority.handleIntent(intent)
}

/** Main-process runtime use only. Never expose this function through preload or IPC. */
export function withIntegrationCredential<Result>(
  ref: CredentialRef,
  consumer: (secret: string) => Result,
): Result {
  return authority.use(ref, consumer)
}
