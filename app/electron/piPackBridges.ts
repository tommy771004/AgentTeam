import type { PiMemory } from './piMemory.ts'
import type { PiContextPacket } from './piDelegationExtension.ts'
import type { PiToolContext } from './piToolHost.ts'
import { DurableMemoryStoreError } from './durableMemoryStore.ts'

/**
 * The bridges between extension packs and Host-owned state.
 *
 * Packs execute inside per-session runtimes, while the durable state they
 * read and write — memories, child sessions, the run queue — lives in the
 * protocol server's snapshot. Rather than giving packs a second store (the
 * exact disease this effort treats), each bridge is a narrow accessor the
 * server installs once; when no server is running, accessors are absent and
 * tools answer structurally instead of pretending.
 */

export type PiMemoryBridgeAccess = {
  search: (query: string, limit: number, ctx: PiToolContext) => Promise<PiMemory[]>
  get: (id: string, ctx: PiToolContext) => Promise<PiMemory | undefined>
  set: (input: { key: string; text: string; tags: string[] }, ctx: PiToolContext) => Promise<PiMemoryWriteReceipt>
  append: (input: { text: string; tags: string[] }, ctx: PiToolContext) => Promise<PiMemoryWriteReceipt>
}

/** Metadata-only identity returned after the SQLite commit. */
export type PiMemoryWriteReceipt = {
  operation: 'set' | 'append'
  id: string
  logicalKey: string
  scope: 'project'
  revision: number
  runId: string
  sessionId: string
  callId: string
}

let memoryBridge: PiMemoryBridgeAccess | undefined

export function setPiMemoryBridge(access: PiMemoryBridgeAccess): void {
  memoryBridge = access
}

/** Missing authority must never fabricate a successful read or durable write. */
export function piMemoryBridge(): PiMemoryBridgeAccess {
  if (!memoryBridge) throw new DurableMemoryStoreError('unavailable', 'Durable memory store is unavailable')
  return memoryBridge
}

export type PiDelegatedRunView = {
  runId: string
  sessionId: string
  status: 'queued' | 'claimed' | 'settled' | 'interrupted'
  settlement?: string
  parentSessionId?: string
  role?: string
  depth?: number
}

export type PiDelegationBridgeAccess = {
  /** Create a child session through the same validation as `sessions/create`. */
  createChild: (input: { parentSessionId: string; role: string; profile: Record<string, unknown>; context: PiContextPacket; depth: number }) => Promise<{ sessionId: string }>
  /** Assign exactly one current parent goal; the Host authors the snapshot. */
  createGoalChild: (input: { parentSessionId: string; parentRunId: string; goalId: string; role: string; profile: Record<string, unknown>; depth: number }) => Promise<{ sessionId: string; delegationId: string; objective: string }>
  /** Queue the child's first turn on the same run queue automation claims from. */
  enqueueChildRun: (input: { runId: string; sessionId: string; prompt: string }) => Promise<void>
  /** Every background work item this Host still knows about. */
  listRuns: () => PiDelegatedRunView[]
  /** Stage parent adoption; the Host settles it only after all sibling effects. */
  requestGoalAdoption: (parentSessionId: string) => void
}

let delegationBridge: PiDelegationBridgeAccess | undefined

export function setPiDelegationBridge(access: PiDelegationBridgeAccess): void {
  delegationBridge = access
}

export function piDelegationBridge(): PiDelegationBridgeAccess | undefined {
  return delegationBridge
}

/* ── Plan snapshots ──────────────────────────────────────────────────── */

export type PiPlanStep = { id: string; title: string; status: 'pending' | 'in_progress' | 'done' }

/**
 * The live plan per session. The durable copy is the Turn Record's `notice`
 * entry the tool appends, so a finished run replays its plans without this
 * map; this only carries what a RUNNING panel needs.
 */
const livePlans = new Map<string, PiPlanStep[]>()

export function setPiLivePlan(sessionId: string, steps: PiPlanStep[]): void {
  livePlans.set(sessionId, steps.map((step) => ({ ...step })))
}

export function getPiLivePlan(sessionId: string): PiPlanStep[] | undefined {
  const plan = livePlans.get(sessionId)
  return plan ? plan.map((step) => ({ ...step })) : undefined
}

/* ── Tool output store ───────────────────────────────────────────────── */

export type PiStoredToolOutput = { id: string; tool: string; text: string; at: number }

const MAX_STORED_OUTPUTS = 64

/**
 * Full outputs of recent pack executions, so `tool_output_read` can page back
 * through something that was truncated in the model-visible content.
 */
const storedOutputs: PiStoredToolOutput[] = []

export function storePiToolOutput(tool: string, text: string): string {
  const id = `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  storedOutputs.push({ id, tool, text, at: Date.now() })
  while (storedOutputs.length > MAX_STORED_OUTPUTS) storedOutputs.shift()
  return id
}

export function readPiStoredOutput(id: string): PiStoredToolOutput | undefined {
  return storedOutputs.find((output) => output.id === id)
}
