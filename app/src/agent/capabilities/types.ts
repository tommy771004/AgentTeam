/** How the current run obtained a capability or tool. */
export type CapabilityUnlockProvenance =
  | 'always-on'
  | 'preloaded'
  | 'load_capability'
  | 'tool_search'
  | 'progressive-off'
  | 'restored'

/**
 * Capability primitive (Pydantic AI 2.0–style):
 * a reusable, composable unit of agent behavior.
 *
 * Bundles: tools + instructions (+ optional always-on flag).
 * deferLoading → progressive disclosure via load_capability.
 */

import type { ToolName } from '../tools/registry.ts'
import type { FeatureId } from '../entitlement.ts'

export type CapabilityId = string

/** Model settings bundled with a capability (Pydantic AI 2.0: capability = instructions + tools + hooks + model settings). */
export interface CapabilityModelSettings {
  /** Override chat model while this capability is active */
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface AgentCapability {
  /** Stable id for load_capability + history resume */
  id: CapabilityId
  /** One-line catalog description shown before load */
  description: string
  /** Runbook / instructions injected when loaded (or always if !deferLoading) */
  instructions?: string
  /** Built-in tools owned by this capability */
  tools?: ToolName[]
  /**
   * FC tool name prefixes this capability owns (e.g. MCP: `mcp_serverId_`).
   * Used to gate dynamically injected tools.
   */
  toolNamePrefixes?: string[]
  /** Exact dynamic tool names (optional) */
  toolNames?: string[]
  /**
   * When true, only catalog line is visible until model calls load_capability.
   * Always-on capabilities contribute tools + instructions from turn 1.
   */
  deferLoading?: boolean
  /** Source for UI / debugging */
  source?: 'builtin' | 'skill' | 'mcp' | 'user' | 'feature-pack'
  /** Optional group label */
  group?: string
  /** Model settings applied while this capability is active (last active wins) */
  modelSettings?: CapabilityModelSettings
  /**
   * Tools that require human approval (HITL ask) before every execution,
   * regardless of permission policy. Capability-declared, Pydantic v2 style.
   */
  approvalTools?: string[]
  /**
   * Issue 07 — Free Core entitlement boundary. When set, this capability is
   * only assembled if `isCapabilityEntitled` (src/agent/entitlement.ts)
   * grants this feature id. Omitted (the default) means Free Core: always
   * available, no entitlement check at all.
   */
  requiresEntitlement?: FeatureId
}

export interface CapabilityCatalogEntry {
  id: CapabilityId
  description: string
  loaded: boolean
  deferLoading: boolean
  source?: AgentCapability['source']
  toolCount: number
}

export interface CapabilityRuntimeState {
  /** All registered capabilities for this run */
  all: AgentCapability[]
  /** Explicitly loaded deferred ids */
  loadedIds: Set<string>
  /** Whether progressive disclosure is active */
  progressive: boolean
  /** Tool Search — hide tool schemas over threshold, retrieve by keyword */
  toolSearch: {
    /** Feature on (settings.toolSearchEnabled && progressive) */
    active: boolean
    /** Hide non-core defs when visible count exceeds this */
    threshold: number
    /** Tool names revealed via tool_search / load_capability */
    unlocked: Set<string>
  }
  /** In-memory provenance for the current run; never treated as user input. */
  provenance: {
    capabilities: Map<string, CapabilityUnlockProvenance>
    tools: Map<string, CapabilityUnlockProvenance>
  }
}
