import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { piVendorDir } from './piVendor.ts'

type AuthStorageInstance = {
  modify: (provider: string, update: (current: unknown) => Promise<{ type: 'api_key'; key: string }>) => Promise<unknown>
}

export type PiCoreCompatibility = {
  packageName: string
  version: string
  createAuthStorage(authPath: string): AuthStorageInstance
}

/**
 * The sole compatibility Adapter for the pinned Pi coding-agent public entry.
 * Vendor upgrades fail here, before a turn can observe a half-compatible
 * runtime; no unpublished dist internals are imported.
 */
async function loadPiCoreCompatibility(): Promise<PiCoreCompatibility> {
  const publicApi = await import(
    /* @vite-ignore */ pathToFileURL(join(piVendorDir, 'packages/coding-agent/dist/index.js')).href
  ) as Record<string, unknown>
  const authStorage = publicApi.AuthStorage as { create?: (path: string) => AuthStorageInstance } | undefined
  if (typeof publicApi.PACKAGE_NAME !== 'string' || typeof publicApi.VERSION !== 'string' || typeof authStorage?.create !== 'function') {
    throw new Error('Pinned Pi Core compatibility exports are unavailable')
  }
  return Object.freeze({
    packageName: publicApi.PACKAGE_NAME,
    version: publicApi.VERSION,
    createAuthStorage: (authPath: string) => authStorage.create!(authPath),
  })
}

export const piCoreCompatibility = await loadPiCoreCompatibility()
