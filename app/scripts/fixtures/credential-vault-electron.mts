// Only the OS boundary is substituted; the shipped vault still owns disk I/O.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

let directory = ''
let available = true
let backend = 'keychain_access'
const key = Buffer.alloc(32, 7) // Test-only key, never an OS-encryption claim.

export function configureVaultTestEnvironment(userData: string, secure: boolean, storageBackend = 'keychain_access') {
  directory = userData
  available = secure
  backend = storageBackend
}

export const app = { getPath: () => directory }
export const safeStorage = {
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
  encryptString(text: string) {
    if (!available) throw new Error('test keychain unavailable')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  },
  decryptString(raw: Buffer) {
    if (!available) throw new Error('test keychain unavailable')
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  },
}
