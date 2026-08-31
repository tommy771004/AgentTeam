import { isMemoryControlPackageIdentity, type MemoryControlPackageIdentity } from './memoryControlPackage.ts'

/** Bounded, Host-authored trace for one drafted tool call's Skill preflight. */
export type SkillPreflightPackageIdentity = MemoryControlPackageIdentity

export type SkillPreflightToolIdentity = {
  tool: string
  contractRevision: number
  contractDigest: string
  schemaDigest: string
  toolSource: 'builtin' | 'extension-pack' | 'mcp' | 'pi-package'
  toolPack?: string
  packageName?: string
  packageVersion?: string
  packageSource?: string
  resourceOrigin?: 'package'
}

export type SkillRevisionIdentity = {
  id: string
  version: number
  digest: string
  bodyBytes: number
}

export type SkillInvocationTrace = {
  schemaVersion: 1 | 2
  invocationId: string
  runId: string
  step: number
  callId: string
  /** Required by schema v2; absent only on legacy v1 invocation records. */
  batchId?: string
  /** Required by schema v2; exact idempotency identity for this original draft. */
  identityDigest?: string
  trigger: 'state-changing-tool-call' | 'contract-required-tool-call'
  workingStateRevision: number
  goalIds: string[]
  retrievalKeyDigest: string
  matchCount: 0 | 1 | 2
  decision: 'pass-through' | 'redraft'
  selectedSkills?: SkillRevisionIdentity[]
  packageIdentity: SkillPreflightPackageIdentity
  toolIdentity: SkillPreflightToolIdentity
  draft: {
    keys: string[]
    serializedBytes: number
    sampleBytes: number
    digest: string
  }
}

export type SkillContextInjectionTrace = {
  schemaVersion: 1 | 2
  /** Exact bounded provider input; absent only in legacy schema v1. */
  context?: string
  runId: string
  originalCallId: string
  tool: string
  skills: SkillRevisionIdentity[]
  contextBytes: number
  contextDigest: string
  freshCallRequired: true
}

const SHA256 = /^[a-f0-9]{64}$/
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

export function isSkillInvocationTrace(value: unknown): value is SkillInvocationTrace {
  if (!value || typeof value !== 'object') return false
  const trace = value as Record<string, unknown>
  if (Object.keys(trace).some((key) => ![
    'schemaVersion', 'invocationId', 'runId', 'step', 'callId', 'batchId', 'identityDigest', 'trigger', 'workingStateRevision', 'goalIds',
    'retrievalKeyDigest', 'matchCount', 'decision', 'selectedSkills', 'packageIdentity', 'toolIdentity', 'draft',
  ].includes(key))) return false
  return isSkillInvocationCoordinates(trace)
    && typeof trace.retrievalKeyDigest === 'string' && SHA256.test(trace.retrievalKeyDigest)
    && isSkillDecision(trace)
    && isPackageIdentity(trace.packageIdentity)
    && isToolIdentity(trace.toolIdentity)
    && isDraftCharacteristics(trace.draft)
}

function isSkillInvocationCoordinates(trace: Record<string, unknown>): boolean {
  return (trace.schemaVersion === 1 || trace.schemaVersion === 2)
    && (trace.schemaVersion === 2
      ? bounded(trace.batchId, 512) && typeof trace.identityDigest === 'string' && SHA256.test(trace.identityDigest)
      : trace.batchId === undefined && trace.identityDigest === undefined)
    && bounded(trace.invocationId, 512)
    && bounded(trace.runId, 512)
    && Number.isSafeInteger(trace.step) && Number(trace.step) > 0
    && bounded(trace.callId, 512)
    && (trace.trigger === 'state-changing-tool-call' || trace.trigger === 'contract-required-tool-call')
    && Number.isSafeInteger(trace.workingStateRevision) && Number(trace.workingStateRevision) > 0
    && Array.isArray(trace.goalIds) && trace.goalIds.length <= 100 && trace.goalIds.every((goal) => bounded(goal, 1_024))
}

function isSkillDecision(trace: Record<string, unknown>): boolean {
  if (trace.matchCount === 0) return trace.decision === 'pass-through' && trace.selectedSkills === undefined
  if (trace.matchCount !== 1 && trace.matchCount !== 2) return false
  return trace.decision === 'redraft'
    && Array.isArray(trace.selectedSkills)
    && trace.selectedSkills.length === trace.matchCount
    && trace.selectedSkills.every(isSkillRevisionIdentity)
}

function isSkillRevisionIdentity(value: unknown): value is SkillRevisionIdentity {
  if (!value || typeof value !== 'object') return false
  const identity = value as Record<string, unknown>
  return Object.keys(identity).every((key) => ['id', 'version', 'digest', 'bodyBytes'].includes(key))
    && bounded(identity.id, 64)
    && Number.isSafeInteger(identity.version) && Number(identity.version) > 0
    && typeof identity.digest === 'string' && SHA256.test(identity.digest)
    && Number.isSafeInteger(identity.bodyBytes) && Number(identity.bodyBytes) > 0 && Number(identity.bodyBytes) <= 16_384
}

export function isSkillContextInjectionTrace(value: unknown): value is SkillContextInjectionTrace {
  if (!value || typeof value !== 'object') return false
  const trace = value as Record<string, unknown>
  return Object.keys(trace).every((key) => [
    'schemaVersion', 'runId', 'originalCallId', 'tool', 'skills', 'context', 'contextBytes', 'contextDigest', 'freshCallRequired',
  ].includes(key))
    && (trace.schemaVersion === 1
      ? trace.context === undefined
      : trace.schemaVersion === 2 && typeof trace.context === 'string'
        && new TextEncoder().encode(trace.context).byteLength === trace.contextBytes)
    && bounded(trace.runId, 512)
    && bounded(trace.originalCallId, 512)
    && bounded(trace.tool, 256)
    && Array.isArray(trace.skills) && trace.skills.length > 0 && trace.skills.length <= 2
    && trace.skills.every(isSkillRevisionIdentity)
    && Number.isSafeInteger(trace.contextBytes) && Number(trace.contextBytes) > 0 && Number(trace.contextBytes) <= 24_576
    && typeof trace.contextDigest === 'string' && SHA256.test(trace.contextDigest)
    && trace.freshCallRequired === true
}

function isPackageIdentity(value: unknown): value is SkillPreflightPackageIdentity {
  return isMemoryControlPackageIdentity(value)
}

function isToolIdentity(value: unknown): value is SkillPreflightToolIdentity {
  if (!value || typeof value !== 'object') return false
  const identity = value as Record<string, unknown>
  return Object.keys(identity).every((key) => ['tool', 'contractRevision', 'contractDigest', 'schemaDigest', 'toolSource', 'toolPack', 'packageName', 'packageVersion', 'packageSource', 'resourceOrigin'].includes(key))
    && bounded(identity.tool, 256)
    && Number.isSafeInteger(identity.contractRevision) && Number(identity.contractRevision) > 0
    && typeof identity.contractDigest === 'string' && SHA256.test(identity.contractDigest)
    && typeof identity.schemaDigest === 'string' && SHA256.test(identity.schemaDigest)
    && (identity.toolSource === 'builtin' || identity.toolSource === 'extension-pack' || identity.toolSource === 'mcp' || identity.toolSource === 'pi-package')
    && (identity.toolPack === undefined || bounded(identity.toolPack, 256))
    && (identity.packageName === undefined || bounded(identity.packageName, 256))
    && (identity.packageVersion === undefined || bounded(identity.packageVersion, 128))
    && (identity.packageSource === undefined || bounded(identity.packageSource, 512))
    && (identity.resourceOrigin === undefined || identity.resourceOrigin === 'package')
    && (identity.toolSource !== 'pi-package' || (bounded(identity.packageName, 256) && bounded(identity.packageVersion, 128) && bounded(identity.packageSource, 512) && identity.resourceOrigin === 'package'))
}

function isDraftCharacteristics(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return Object.keys(draft).every((key) => ['keys', 'serializedBytes', 'sampleBytes', 'digest'].includes(key))
    && Array.isArray(draft.keys) && draft.keys.length <= 64 && draft.keys.every((key) => bounded(key, 128))
    && Number.isSafeInteger(draft.serializedBytes) && Number(draft.serializedBytes) >= 0 && Number(draft.serializedBytes) <= 65_536
    && Number.isSafeInteger(draft.sampleBytes) && Number(draft.sampleBytes) >= 0 && Number(draft.sampleBytes) <= 4_096
    && typeof draft.digest === 'string' && SHA256.test(draft.digest)
}
