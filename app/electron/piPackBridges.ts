import type { PiMemory } from './piMemory.ts'
import type { PiContextPacket } from './piDelegationExtension.ts'
import type { PiToolContext } from './piToolHost.ts'
import { DurableMemoryStoreError } from './durableMemoryStore.ts'
import type { ContinuationItem } from '../src/agent/continuation.ts'

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
  /** Atomically admit the child and its first run through Agent Communication. */
  spawnChild: (input: {
    spawnId: string
    runId: string
    parentSessionId: string
    parentRunId: string
    objective: string
    role: string
    profile: Record<string, unknown>
    context: PiContextPacket
    depth: number
    workspace?: Record<string, unknown>
    goalId?: string
  }) => Promise<{ sessionId: string; runId: string; delegationId?: string; objective: string }>
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

export type PiPlanStep = {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  meta?: string
  details?: Array<{ label: string; meta?: string }>
}

export type PiPlanGateCandidate = {
  runId: string
  summary: string
  steps: string[]
  acceptanceCriteria: string[]
  unresolvedQuestions: string[]
  requiresAdditionalAuthority: boolean
}

/**
 * The live plan per session. The durable copy is the Turn Record's `notice`
 * entry the tool appends, so a finished run replays its plans without this
 * map; this only carries what a RUNNING panel needs.
 */
const livePlans = new Map<string, PiPlanStep[]>()
const planGateCandidates = new Map<string, PiPlanGateCandidate>()
const continuationItems = new Map<string, { runId: string; items: ContinuationItem[] }>()

function clonePlanStep(step: PiPlanStep): PiPlanStep {
  return {
    ...step,
    details: step.details?.map((detail) => ({ ...detail })),
  }
}

export function setPiLivePlan(sessionId: string, steps: PiPlanStep[]): void {
  livePlans.set(sessionId, steps.map(clonePlanStep))
}

export function setPiPlanGateCandidate(sessionId: string, candidate: PiPlanGateCandidate): void {
  planGateCandidates.set(sessionId, structuredClone(candidate))
}

export function consumePiPlanGateCandidate(sessionId: string, runId: string): PiPlanGateCandidate | undefined {
  const candidate = planGateCandidates.get(sessionId)
  if (!candidate || candidate.runId !== runId) return undefined
  planGateCandidates.delete(sessionId)
  return structuredClone(candidate)
}

export function clearPiPlanGateCandidate(sessionId: string, runId?: string): void {
  const candidate = planGateCandidates.get(sessionId)
  if (!candidate || (runId && candidate.runId !== runId)) return
  planGateCandidates.delete(sessionId)
}

export function setPiContinuationItems(sessionId: string, runId: string, items: readonly ContinuationItem[]): void {
  continuationItems.set(sessionId, { runId, items: structuredClone(Array.from(items)) })
}

export function getPiContinuationItems(sessionId: string, runId: string): ContinuationItem[] {
  const snapshot = continuationItems.get(sessionId)
  return snapshot?.runId === runId ? structuredClone(snapshot.items) : []
}

export function clearPiContinuationItems(sessionId: string, runId?: string): void {
  const snapshot = continuationItems.get(sessionId)
  if (!snapshot || (runId && snapshot.runId !== runId)) return
  continuationItems.delete(sessionId)
}
