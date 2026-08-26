import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * One place resolves the vendored Pi Core directory and imports its barrel.
 *
 * Both the runtime (tool factories) and the extension packs (the file
 * mutation queue) need the same dynamic import with the same candidate
 * fallbacks, so they share this module instead of each guessing at paths.
 *
 * Resolution is CWD-INDEPENDENT on purpose. A packaged macOS/Windows app
 * launches with process.cwd() === '/', so cwd-relative candidates resolve to
 * nonsense like /vendor/pi — the release crash of 2026-08-26. The candidates
 * below are anchored to things that survive packaging:
 *
 * 1. `SUBAGENTS_PI_VENDOR_DIR` — explicit override (tests, host child env).
 * 2. This module's own location: dist-electron sits two levels under the app
 *    root in dev and under `Resources/app.asar` when packaged, so
 *    `../../vendor/pi` lands on `<repo>/vendor/pi` in dev and
 *    `Resources/vendor/pi` (extraResources target) in production alike.
 * 3. `process.resourcesPath/vendor/pi` — the extraResources destination,
 *    belt-and-suspenders for packaged builds.
 * 4. Legacy cwd candidates last, kept for unusual launch scripts.
 */

const moduleDir = dirname(fileURLToPath(import.meta.url))

const vendorCandidates = [
  process.env.SUBAGENTS_PI_VENDOR_DIR,
  resolve(moduleDir, '../../vendor/pi'),
  process.resourcesPath ? join(process.resourcesPath, 'vendor/pi') : undefined,
  join(process.cwd(), 'vendor/pi'),
  join(process.cwd(), '../vendor/pi'),
].filter((candidate): candidate is string => Boolean(candidate))

export const piVendorDir = vendorCandidates.find((candidate) => existsSync(join(candidate, 'packages/coding-agent/dist/index.js'))) || vendorCandidates[0]
if (!piVendorDir || !existsSync(join(piVendorDir, 'packages/coding-agent/dist/index.js'))) {
  throw new Error(
    `Vendored Pi Core directory not found. Tried: ${vendorCandidates.join(' ; ')}`,
  )
}

export const piCodingAgentModule = await import(/* @vite-ignore */ pathToFileURL(join(piVendorDir, 'packages/coding-agent/dist/index.js')).href)

type FileMutationQueueModule = {
  withFileMutationQueue: <T>(filePath: string, fn: () => Promise<T>) => Promise<T>
}

/**
 * Pi's own per-file serialization, shared with builtin edit/write: operations
 * for different files still run in parallel.
 */
export function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const queue = (piCodingAgentModule as Partial<FileMutationQueueModule>).withFileMutationQueue
  if (typeof queue !== 'function') throw new Error('Pi withFileMutationQueue is unavailable')
  return queue(filePath, fn)
}
