/**
 * Pack registration for the Host process.
 *
 * Importing this module registers every shipped pack exactly once; new packs
 * join here. This is the only place that knows the full pack list — the
 * catalog, the extension factories, and direct execution all read from the
 * registry it fills.
 */
import { ensureIntegrationsPackRegistered } from './integrations.ts'
import { ensureMemoryPackRegistered } from './memoryPack.ts'
import { ensureInteractionPlanningPacksRegistered } from './interactionPlanning.ts'
import { ensureBackgroundWorkPackRegistered } from './backgroundWork.ts'
import { ensureWorkspaceExtraPackRegistered } from './workspaceExtra.ts'
import { ensureWorkspaceTextSearchPackRegistered } from './workspaceTextSearch.ts'
import { ensureUtilityPackRegistered } from './utility.ts'
import { ensureCodegraphPackRegistered } from './codegraph.ts'
import { ensureMcpBridgePackRegistered } from './mcpBridgePack.ts'
import { ensureSubDesignPackRegistered } from './subdesignPack.ts'
import { ensureFrameworkPackRegistered } from './framework.ts'
import { ensureCustomToolsPackRegistered } from './customToolsPack.ts'

export function ensurePiPacksRegistered(): void {
  ensureIntegrationsPackRegistered()
  ensureMemoryPackRegistered()
  ensureInteractionPlanningPacksRegistered()
  ensureBackgroundWorkPackRegistered()
  ensureWorkspaceExtraPackRegistered()
  ensureWorkspaceTextSearchPackRegistered()
  ensureUtilityPackRegistered()
  ensureCodegraphPackRegistered()
  ensureMcpBridgePackRegistered()
  ensureSubDesignPackRegistered()
  ensureFrameworkPackRegistered()
  ensureCustomToolsPackRegistered()
}
