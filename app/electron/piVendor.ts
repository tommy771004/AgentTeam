import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * One place resolves the vendored Pi Core directory and imports its barrel.
 *
 * Both the runtime (tool factories) and the extension packs (the file
 * mutation queue) need the same dynamic import with the same candidate
 * fallbacks, so they share this module instead of each guessing at paths.
 */

const vendorCandidates = [
  process.env.SUBAGENTS_PI_VENDOR_DIR,
  join(process.cwd(), 'vendor/pi'),
  join(process.cwd(), '../vendor/pi'),
].filter((candidate): candidate is string => Boolean(candidate))

export const piVendorDir = vendorCandidates.find((candidate) => existsSync(join(candidate, 'packages/coding-agent/dist/index.js'))) || vendorCandidates[0]
if (!piVendorDir) throw new Error('Vendored Pi Core directory is not configured')

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
