/**
 * Pack registration for the Host process.
 *
 * Importing this module registers every shipped pack exactly once; new packs
 * join here. This is the only place that knows the full pack list — the
 * catalog, the extension factories, and direct execution all read from the
 * registry it fills.
 */
import { ensureIntegrationsPackRegistered } from './integrations.ts'

export function ensurePiPacksRegistered(): void {
  ensureIntegrationsPackRegistered()
}
