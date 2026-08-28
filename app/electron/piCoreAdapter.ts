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
 * The sole compatibility Adapter for Pi coding-agent internals. Upstream does
 * not yet export AuthStorage publicly; pin upgrades fail here, before a turn
 * can observe a half-compatible runtime.
 */
async function loadPiCoreCompatibility(): Promise<PiCoreCompatibility> {
  const config = await import(/* @vite-ignore */ pathToFileURL(join(piVendorDir, 'packages/coding-agent/dist/config.js')).href) as Record<string, unknown>
  const authModule = await import(
    /* @vite-ignore */ pathToFileURL(join(piVendorDir, 'packages/coding-agent/dist/core/auth-storage.js')).href
  ) as Record<string, unknown>
  const authStorage = authModule.AuthStorage as { create?: (path: string) => AuthStorageInstance } | undefined
  if (typeof config.PACKAGE_NAME !== 'string' || typeof config.VERSION !== 'string' || typeof authStorage?.create !== 'function') {
    throw new Error('Pinned Pi Core compatibility exports are unavailable')
  }
  return Object.freeze({
    packageName: config.PACKAGE_NAME,
    version: config.VERSION,
    createAuthStorage: (authPath: string) => authStorage.create!(authPath),
  })
}

export const piCoreCompatibility = await loadPiCoreCompatibility()
