import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalJson } from './piToolContract.ts'
import { compileMemoryControlRuntime } from './memoryControlRuntime.ts'
import type {
  MemoryControlComponent,
  MemoryControlComponentKey,
  MemoryControlJsonPatchOperation,
  MemoryControlLifecycleEvent,
  MemoryControlLineage,
  MemoryControlPackage,
  MemoryControlPackageReader,
} from '../src/agent/memoryControlPackage.ts'
import { isMemoryControlPackageIdentity, MEMORY_CONTROL_COMPONENT_KEYS } from '../src/agent/memoryControlPackage.ts'
import {
  canonicalMemoryControlEvaluationJson,
  type MemoryControlEvaluationReport,
  type MemoryControlEvaluationRun,
} from '../src/agent/memoryControlEvaluationContract.ts'

type ComponentDraft = Omit<MemoryControlComponent, 'digest'> | MemoryControlComponent
type PackageComponents = MemoryControlPackage['components']
type PackageComponentDrafts = { [K in keyof PackageComponents]: ComponentDraft }

export type MemoryControlPackageDocument = {
  schemaVersion: 1
  activeRevision: number
  packages: MemoryControlPackage[]
  events: MemoryControlLifecycleEvent[]
  evaluations: MemoryControlEvaluationReport[]
}

const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
const sha256Text = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
export const MAX_MEMORY_CONTROL_REPOSITORY_BYTES = 2 * 1024 * 1024
export const MAX_MEMORY_CONTROL_PACKAGES = 128
export const MAX_MEMORY_CONTROL_COMPONENT_BYTES = 64 * 1024
export const MAX_MEMORY_CONTROL_PATCH_BYTES = 32 * 1024
export const MAX_MEMORY_CONTROL_PATCH_OPERATIONS = 64
export const MAX_MEMORY_CONTROL_LIFECYCLE_EVENTS = 512
export const MAX_MEMORY_CONTROL_EVALUATION_REPORTS = 32
export const MAX_MEMORY_CONTROL_EVALUATION_REPORT_BYTES = 256 * 1024
export const MAX_MEMORY_CONTROL_REASON_BYTES = 2 * 1024
const STALE_MEMORY_CONTROL_LOCK_MS = 30_000
const MAX_COMPONENT_DEPTH = 32
const MAX_COMPONENT_NODES = 10_000
const MAX_CONTAINER_ITEMS = 1_024
const MAX_STRING_BYTES = 16 * 1024

function validateBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1
  if (depth > MAX_COMPONENT_DEPTH || budget.nodes > MAX_COMPONENT_NODES) throw new Error('Memory-Control Package component body exceeds bounds')
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw new Error('Memory-Control Package component body exceeds bounds')
    return
  }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTAINER_ITEMS) throw new Error('Memory-Control Package component body exceeds bounds')
    for (const child of value) validateBoundedJson(child, depth + 1, budget)
    return
  }
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package component body is not JSON')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_CONTAINER_ITEMS) throw new Error('Memory-Control Package component body exceeds bounds')
  for (const [key, child] of entries) {
    if (Buffer.byteLength(key, 'utf8') > 256) throw new Error('Memory-Control Package component body exceeds bounds')
    validateBoundedJson(child, depth + 1, budget)
  }
}

function validateComponentBody(body: unknown): asserts body is Readonly<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Memory-Control Package component body is corrupt')
  validateBoundedJson(body)
  if (Buffer.byteLength(canonicalJson(body), 'utf8') > MAX_MEMORY_CONTROL_COMPONENT_BYTES) {
    throw new Error('Memory-Control Package component body exceeds bounds')
  }
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function immutableClone<T>(value: T): T {
  return freezeDeep(structuredClone(value))
}

function component(input: ComponentDraft): MemoryControlComponent {
  validateComponentBody(input.body)
  const identity = { id: input.id, revision: input.revision }
  return immutableClone({ ...identity, digest: sha256({ ...identity, body: input.body }), body: input.body })
}

export function createMemoryControlPackage(input: {
  id: string
  revision: number
  parentRevision?: number
  diagnosisComponent?: MemoryControlComponentKey
  status: MemoryControlPackage['status']
  components: PackageComponentDrafts
}): MemoryControlPackage {
  if (input.status === 'candidate' && !input.diagnosisComponent) {
    throw new Error('Memory-Control Package candidate must declare one diagnosis component')
  }
  const components = Object.fromEntries(Object.entries(input.components).map(([key, value]) => [key, component(value)])) as PackageComponents
  const identityBody = {
    id: input.id,
    revision: input.revision,
    ...(input.parentRevision ? { parentRevision: input.parentRevision } : {}),
    ...(input.diagnosisComponent ? { diagnosisComponent: input.diagnosisComponent } : {}),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, {
      id: value.id, revision: value.revision, digest: value.digest,
    }])),
  }
  return immutableClone({
    schemaVersion: 1 as const,
    ...identityBody,
    digest: sha256(identityBody),
    status: input.status,
    components,
  })
}

export const BASELINE_MEMORY_CONTROL_PACKAGE = createMemoryControlPackage({
  id: 'agentteam-memory-control-baseline',
  revision: 1,
  status: 'active',
  components: {
    experientialSkills: {
      id: 'experiential-skills', revision: 1,
      body: { source: 'frozen-skill-resource-view', selection: 'exact-tool', maxSelectedSkills: 2 },
    },
    workingMemorySpec: {
      id: 'verified-working-state', revision: 1,
      body: { schemaVersion: 1, authority: 'pi-core-host', optimisticConcurrency: true },
    },
    invocationPolicy: {
      id: 'skill-preflight-policy', revision: 1,
      body: { trigger: 'state-changing-or-contract-required', batchBarrier: true, maxSkills: 2 },
    },
    checkers: {
      id: 'host-working-state-checkers', revision: 1,
      body: { fileContent: 1, delegatedGoal: 1, modelClaimsAreEvidence: false },
    },
  },
})

export function memoryControlPackageDocument(
  packages: readonly MemoryControlPackage[],
  activeRevision: number,
  events: readonly MemoryControlLifecycleEvent[] = [],
  evaluations: readonly MemoryControlEvaluationReport[] = [],
): MemoryControlPackageDocument {
  return {
    schemaVersion: 1,
    activeRevision,
    events: events.map((event) => immutableClone(event)),
    evaluations: evaluations.map((report) => immutableClone(report)),
    packages: packages.map((entry) => immutableClone({
      ...entry,
      status: entry.revision === activeRevision ? 'active' : entry.status === 'active' ? 'rejected' : entry.status,
    })),
  }
}

function validateComponent(value: unknown): MemoryControlComponent {
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package component is corrupt')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['id', 'revision', 'digest', 'body'].includes(key))
    || typeof item.id !== 'string' || !item.id || item.id.length > 256
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || typeof item.digest !== 'string' || !item.body || typeof item.body !== 'object' || Array.isArray(item.body)) {
    throw new Error('Memory-Control Package component is corrupt')
  }
  const expected = component(item as unknown as ComponentDraft)
  if (expected.digest !== item.digest) throw new Error(`Memory-Control Package component digest mismatch: ${item.id}`)
  return expected
}

function validatePackage(value: unknown): MemoryControlPackage {
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package is corrupt')
  const item = value as Record<string, unknown>
  validatePackageEnvelope(item)
  const raw = item.components as Record<string, unknown>
  const keys = ['experientialSkills', 'workingMemorySpec', 'invocationPolicy', 'checkers'] as const
  if (Object.keys(raw).length !== keys.length || keys.some((key) => !(key in raw))) throw new Error('Memory-Control Package components are incomplete')
  const rebuilt = createMemoryControlPackage({
    id: String(item.id),
    revision: Number(item.revision),
    ...(item.parentRevision === undefined ? {} : { parentRevision: Number(item.parentRevision) }),
    ...(item.diagnosisComponent === undefined ? {} : { diagnosisComponent: item.diagnosisComponent as MemoryControlComponentKey }),
    status: item.status as MemoryControlPackage['status'],
    components: Object.fromEntries(keys.map((key) => [key, validateComponent(raw[key])])) as PackageComponentDrafts,
  })
  if (rebuilt.digest !== item.digest) throw new Error(`Memory-Control Package digest mismatch: ${item.id}@${item.revision}`)
  return rebuilt
}

function validatePackageEnvelope(item: Record<string, unknown>): void {
  const allowed = ['schemaVersion', 'id', 'revision', 'parentRevision', 'diagnosisComponent', 'digest', 'status', 'components']
  const invalidParent = item.parentRevision !== undefined
    && (!Number.isSafeInteger(item.parentRevision) || Number(item.parentRevision) < 1)
  const invalidDiagnosis = item.diagnosisComponent !== undefined
    && !MEMORY_CONTROL_COMPONENT_KEYS.includes(item.diagnosisComponent as MemoryControlComponentKey)
  const invalidComponents = !item.components || typeof item.components !== 'object' || Array.isArray(item.components)
  if (Object.keys(item).some((key) => !allowed.includes(key))
    || item.schemaVersion !== 1 || typeof item.id !== 'string' || !item.id || item.id.length > 256
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || invalidParent || invalidDiagnosis || !['candidate', 'active', 'rejected'].includes(String(item.status)) || invalidComponents) {
    throw new Error('Memory-Control Package is corrupt')
  }
}

function validateReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > MAX_MEMORY_CONTROL_REASON_BYTES) {
    throw new Error('Memory-Control Package lifecycle reason is invalid or exceeds bounds')
  }
  return value.trim()
}

function validateLifecycleEvent(value: unknown, index: number): MemoryControlLifecycleEvent {
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package lifecycle event is corrupt')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['sequence', 'kind', 'revision', 'fromRevision', 'diagnosisComponent', 'reason'].includes(key))
    || item.sequence !== index + 1
    || !['candidate-created', 'candidate-activated', 'candidate-rejected', 'rollback'].includes(String(item.kind))
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || (item.fromRevision !== undefined && (!Number.isSafeInteger(item.fromRevision) || Number(item.fromRevision) < 1))
    || (item.diagnosisComponent !== undefined && !MEMORY_CONTROL_COMPONENT_KEYS.includes(item.diagnosisComponent as MemoryControlComponentKey))) {
    throw new Error('Memory-Control Package lifecycle event is corrupt')
  }
  return immutableClone({
    sequence: Number(item.sequence),
    kind: item.kind as MemoryControlLifecycleEvent['kind'],
    revision: Number(item.revision),
    ...(item.fromRevision === undefined ? {} : { fromRevision: Number(item.fromRevision) }),
    ...(item.diagnosisComponent === undefined ? {} : { diagnosisComponent: item.diagnosisComponent as MemoryControlComponentKey }),
    reason: validateReason(item.reason),
  })
}

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000

function validateEvaluationMetrics(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control evaluation metrics are corrupt')
  const metrics = value as Record<string, unknown>
  if (!exactKeys(metrics, ['taskSuccessRate', 'falseDoneRate', 'requiredActionRecall', 'skillInvocationPrecision', 'skillInvocationReach', 'promptTokens', 'tokensPerSuccess'])
    || !unit(metrics.taskSuccessRate) || !unit(metrics.falseDoneRate) || !unit(metrics.requiredActionRecall)
    || !unit(metrics.skillInvocationPrecision) || !unit(metrics.skillInvocationReach) || !count(metrics.promptTokens)
    || !(metrics.tokensPerSuccess === null || typeof metrics.tokensPerSuccess === 'number' && Number.isFinite(metrics.tokensPerSuccess) && metrics.tokensPerSuccess >= 0 && metrics.tokensPerSuccess <= 100_000_000)) {
    throw new Error('Memory-Control evaluation metrics are corrupt')
  }
}

function validateEvaluationTrace(value: unknown, runId: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control evaluation trace is corrupt')
  const trace = value as Record<string, unknown>
  if (!exactKeys(trace, ['runId', 'firstSeq', 'lastSeq', 'entryCount', 'digest']) || trace.runId !== runId
    || !Number.isSafeInteger(trace.firstSeq) || Number(trace.firstSeq) < 1
    || !Number.isSafeInteger(trace.lastSeq) || Number(trace.lastSeq) < Number(trace.firstSeq)
    || !Number.isSafeInteger(trace.entryCount) || Number(trace.entryCount) < 1 || Number(trace.entryCount) > 100_000
    || typeof trace.digest !== 'string' || !/^[a-f0-9]{64}$/.test(trace.digest)) throw new Error('Memory-Control evaluation trace is corrupt')
}

function validateEvaluationRunMetrics(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control evaluation run metrics are corrupt')
  const metrics = value as Record<string, unknown>
  if (!exactKeys(metrics, ['taskSuccess', 'falseDone', 'requiredActionRecall', 'skillInvocationPrecision', 'skillInvocationReach', 'promptTokens'])
    || typeof metrics.taskSuccess !== 'boolean' || typeof metrics.falseDone !== 'boolean'
    || !unit(metrics.requiredActionRecall) || !unit(metrics.skillInvocationPrecision) || !unit(metrics.skillInvocationReach)
    || !count(metrics.promptTokens)) throw new Error('Memory-Control evaluation run metrics are corrupt')
}

function validateEvaluationRun(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control evaluation run is corrupt')
  const run = value as Record<string, unknown>
  if (!exactKeys(run, ['phase', 'cohort', 'taskId', 'runId', 'governingPackage', 'metrics', 'traceRef'])
    || !['baseline', 'candidate'].includes(String(run.phase)) || !['source-failure', 'held-out-anchor'].includes(String(run.cohort))
    || typeof run.taskId !== 'string' || !run.taskId || run.taskId.length > 256
    || typeof run.runId !== 'string' || !run.runId || run.runId.length > 512
    || !isMemoryControlPackageIdentity(run.governingPackage)) throw new Error('Memory-Control evaluation run is corrupt')
  validateEvaluationTrace(run.traceRef, run.runId)
  validateEvaluationRunMetrics(run.metrics)
}

const validEvaluationReasons = (value: unknown): value is string[] => Array.isArray(value)
  && value.length <= 64 && value.every((reason) => typeof reason === 'string' && reason.length > 0 && reason.length <= 2_000)
const validEvaluationRuns = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 64

function evaluationReportEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control evaluation report is corrupt')
  validateBoundedJson(value)
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > MAX_MEMORY_CONTROL_EVALUATION_REPORT_BYTES) throw new Error('Memory-Control evaluation report exceeds bounds')
  const report = value as Record<string, unknown>
  if (!exactKeys(report, ['schemaVersion', 'reportId', 'corpusVersion', 'baselinePackage', 'candidatePackage', 'decision', 'reasons', 'tokenBudget', 'runs', 'metrics'])
    || report.schemaVersion !== 1 || typeof report.reportId !== 'string' || !/^[a-f0-9]{64}$/.test(report.reportId)
    || typeof report.corpusVersion !== 'string' || !report.corpusVersion || report.corpusVersion.length > 128
    || !isMemoryControlPackageIdentity(report.baselinePackage) || !isMemoryControlPackageIdentity(report.candidatePackage)
    || !['promoted', 'rejected'].includes(String(report.decision)) || !validEvaluationReasons(report.reasons)
    || !validEvaluationRuns(report.runs) || !report.tokenBudget || typeof report.tokenBudget !== 'object') {
    throw new Error('Memory-Control evaluation report is corrupt')
  }
  return report
}

function validateEvaluationReport(value: unknown): MemoryControlEvaluationReport {
  const report = evaluationReportEnvelope(value) as unknown as MemoryControlEvaluationReport
  const budget = report.tokenBudget as Record<string, unknown>
  if (!exactKeys(budget, ['maxRegressionRatio']) || !unit(budget.maxRegressionRatio) || (report.decision === 'promoted') !== (report.reasons.length === 0)) {
    throw new Error('Memory-Control evaluation report decision or budget is corrupt')
  }
  report.runs.forEach(validateEvaluationRun)
  validateEvaluationMetrics(report.metrics)
  const { reportId: _reportId, ...body } = report
  if (sha256Text(canonicalMemoryControlEvaluationJson(body)) !== report.reportId) throw new Error('Memory-Control evaluation report digest mismatch')
  return immutableClone(report as unknown as MemoryControlEvaluationReport)
}

function migrateUnqualifiedActive(
  packages: readonly MemoryControlPackage[],
  events: readonly MemoryControlLifecycleEvent[],
  evaluations: readonly MemoryControlEvaluationReport[],
  activeRevision: number,
): MemoryControlPackageDocument {
  const qualified = new Set([1, ...evaluations.filter((report) => report.decision === 'promoted').map((report) => report.candidatePackage.revision)])
  if (qualified.has(activeRevision)) return memoryControlPackageDocument(packages, activeRevision, events, evaluations)
  const fallbackRevision = [...qualified]
    .filter((revision) => packages.some((entry) => entry.revision === revision))
    .sort((left, right) => right - left)[0] || 1
  return memoryControlPackageDocument(packages, fallbackRevision, [...events, {
    sequence: events.length + 1,
    kind: 'rollback',
    revision: fallbackRevision,
    fromRevision: activeRevision,
    reason: 'legacy-unqualified activation migration; requalification required',
  }], evaluations)
}

function parseDocument(source: string): MemoryControlPackageDocument {
  if (Buffer.byteLength(source, 'utf8') > MAX_MEMORY_CONTROL_REPOSITORY_BYTES) throw new Error('Memory-Control Package repository exceeds bounds')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('Memory-Control Package repository is corrupt') }
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package repository is corrupt')
  const document = value as Record<string, unknown>
  if (Object.keys(document).some((key) => !['schemaVersion', 'activeRevision', 'packages', 'events', 'evaluations'].includes(key))
    || document.schemaVersion !== 1 || !Number.isSafeInteger(document.activeRevision) || !Array.isArray(document.packages)
    || document.packages.length < 1 || document.packages.length > MAX_MEMORY_CONTROL_PACKAGES
    || (document.events !== undefined && (!Array.isArray(document.events) || document.events.length > MAX_MEMORY_CONTROL_LIFECYCLE_EVENTS))
    || (document.evaluations !== undefined && (!Array.isArray(document.evaluations) || document.evaluations.length > MAX_MEMORY_CONTROL_EVALUATION_REPORTS))) {
    throw new Error('Memory-Control Package repository schema version or shape is invalid')
  }
  const packages = document.packages.map(validatePackage)
  const persistedEvents = (document.events || []).map(validateLifecycleEvent)
  const evaluations = (document.evaluations || []).map(validateEvaluationReport)
  validatePackageLineage(packages, Number(document.activeRevision))
  const events = persistedEvents.length > 0
    ? persistedEvents
    : migrateLegacyLifecycle(packages, Number(document.activeRevision))
  const migrated = migrateUnqualifiedActive(packages, events, evaluations, Number(document.activeRevision))
  validateLifecycleHistory(migrated.packages, migrated.events, migrated.activeRevision)
  return immutableClone(migrated)
}

function diagnosisFor(parent: MemoryControlPackage, child: MemoryControlPackage): MemoryControlComponentKey | undefined {
  if (child.diagnosisComponent) return child.diagnosisComponent
  const changed = MEMORY_CONTROL_COMPONENT_KEYS.filter((key) => child.components[key].digest !== parent.components[key].digest)
  return changed.length === 1 ? changed[0] : undefined
}

function migrateLegacyLifecycle(
  packages: readonly MemoryControlPackage[],
  activeRevision: number,
): MemoryControlLifecycleEvent[] {
  if (activeRevision === 1) return []
  const chain: MemoryControlPackage[] = []
  let current = packages.find((entry) => entry.revision === activeRevision)
  while (current?.parentRevision !== undefined) {
    chain.push(current)
    current = packages.find((entry) => entry.revision === current?.parentRevision)
  }
  if (!current || current.revision !== 1 || chain.length + 1 !== packages.length) {
    throw new Error('Memory-Control Package legacy lifecycle is ambiguous')
  }
  const events: MemoryControlLifecycleEvent[] = []
  for (const entry of chain.reverse()) {
    const parent = packages.find((candidate) => candidate.revision === entry.parentRevision)!
    const diagnosisComponent = diagnosisFor(parent, entry)
    if (!diagnosisComponent) throw new Error('Memory-Control Package legacy diagnosis is ambiguous')
    events.push({
      sequence: events.length + 1, kind: 'candidate-created', revision: entry.revision,
      fromRevision: parent.revision, diagnosisComponent, reason: 'legacy schema-v1 lineage migration',
    })
    events.push({
      sequence: events.length + 1, kind: 'candidate-activated', revision: entry.revision,
      fromRevision: parent.revision, diagnosisComponent, reason: 'legacy schema-v1 active revision migration',
    })
  }
  return events
}

function validatePackageLineage(packages: readonly MemoryControlPackage[], activeRevision: number): void {
  const revisions = new Set<number>()
  for (const entry of packages) {
    if (revisions.has(entry.revision)) throw new Error('Memory-Control Package revision is duplicated')
    revisions.add(entry.revision)
    if (entry.parentRevision === undefined) {
      if (entry.revision !== 1) throw new Error('Memory-Control Package non-root revision has no parent')
      continue
    }
    const parent = packages.find((candidate) => candidate.revision === entry.parentRevision)
    if (!parent || parent.id !== entry.id || parent.revision >= entry.revision) {
      throw new Error('Memory-Control Package parent lineage is unknown or corrupt')
    }
    const changedComponents = MEMORY_CONTROL_COMPONENT_KEYS.filter((key) => entry.components[key].digest !== parent.components[key].digest)
    const diagnosisComponent = entry.diagnosisComponent || (changedComponents.length === 1 ? changedComponents[0] : undefined)
    if (!diagnosisComponent) throw new Error('Memory-Control Package non-root revision has no unambiguous diagnosis component')
    validateComponentLineage(parent, entry, diagnosisComponent)
  }
  const active = packages.find((entry) => entry.revision === activeRevision)
  if (!active || active.status !== 'active' || packages.filter((entry) => entry.status === 'active').length !== 1) {
    throw new Error('Memory-Control Package active revision is unknown or corrupt')
  }
}

function validateComponentLineage(
  parent: MemoryControlPackage,
  child: MemoryControlPackage,
  diagnosisComponent: MemoryControlComponentKey,
): void {
  for (const key of MEMORY_CONTROL_COMPONENT_KEYS) {
    const childComponent = child.components[key]
    const parentComponent = parent.components[key]
    if (key !== diagnosisComponent && childComponent.digest !== parentComponent.digest) {
      throw new Error('Memory-Control Package lineage changed an undiagnosed component')
    }
    if (key === diagnosisComponent
      && (childComponent.digest === parentComponent.digest || childComponent.id !== parentComponent.id
        || childComponent.revision !== parentComponent.revision + 1)) {
      throw new Error('Memory-Control Package diagnosed component revision is invalid')
    }
  }
}

function validateLifecycleHistory(
  packages: readonly MemoryControlPackage[],
  events: readonly MemoryControlLifecycleEvent[],
  activeRevision: number,
): void {
  const byRevision = new Map(packages.map((entry) => [entry.revision, entry]))
  const statuses = new Map(packages.map((entry) => [entry.revision, entry.revision === 1 ? 'active' : 'unseen']))
  const previouslyActive = new Set([1])
  let active = 1
  for (const event of events) {
    const entry = byRevision.get(event.revision)
    if (!entry || (event.fromRevision !== undefined && !byRevision.has(event.fromRevision))) throw new Error('Memory-Control Package lifecycle event references an unknown revision')
    if (event.kind === 'candidate-created') validateCandidateCreatedEvent(entry, event, statuses, byRevision)
    else if (event.kind === 'candidate-activated') {
      if (statuses.get(entry.revision) !== 'candidate' || event.fromRevision !== active || entry.parentRevision !== active
        || !lifecycleDiagnosisMatches(entry, event, byRevision)) throw new Error('Memory-Control Package activation history is corrupt')
      statuses.set(active, 'rejected')
      statuses.set(entry.revision, 'active')
      active = entry.revision
      previouslyActive.add(active)
    } else if (event.kind === 'candidate-rejected') {
      if (statuses.get(entry.revision) !== 'candidate' || event.fromRevision !== entry.parentRevision
        || !lifecycleDiagnosisMatches(entry, event, byRevision)) throw new Error('Memory-Control Package rejection history is corrupt')
      statuses.set(entry.revision, 'rejected')
    } else {
      if (event.fromRevision !== active || !previouslyActive.has(entry.revision)) throw new Error('Memory-Control Package rollback history is corrupt')
      statuses.set(active, 'rejected')
      statuses.set(entry.revision, 'active')
      active = entry.revision
    }
  }
  if (active !== activeRevision || packages.some((entry) => statuses.get(entry.revision) !== entry.status)) {
    throw new Error('Memory-Control Package lifecycle status projection is corrupt')
  }
}

function lifecycleDiagnosisMatches(
  entry: MemoryControlPackage,
  event: MemoryControlLifecycleEvent,
  packages: Map<number, MemoryControlPackage>,
): boolean {
  const parent = entry.parentRevision === undefined ? undefined : packages.get(entry.parentRevision)
  return Boolean(parent) && event.diagnosisComponent === diagnosisFor(parent!, entry)
}

function validateCandidateCreatedEvent(
  entry: MemoryControlPackage,
  event: MemoryControlLifecycleEvent,
  statuses: Map<number, string>,
  packages: Map<number, MemoryControlPackage>,
): void {
  const parent = entry.parentRevision === undefined ? undefined : packages.get(entry.parentRevision)
  const diagnosisComponent = parent ? diagnosisFor(parent, entry) : undefined
  if (!parent || statuses.get(entry.revision) !== 'unseen' || event.fromRevision !== parent.revision
    || event.diagnosisComponent !== diagnosisComponent) throw new Error('Memory-Control Package candidate creation history is corrupt')
  statuses.set(entry.revision, 'candidate')
}

async function atomicWrite(path: string, document: MemoryControlPackageDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function readDocument(path: string): Promise<MemoryControlPackageDocument> {
  const metadata = await stat(path)
  if (metadata.size > MAX_MEMORY_CONTROL_REPOSITORY_BYTES) throw new Error('Memory-Control Package repository exceeds bounds')
  return parseDocument(await readFile(path, 'utf8'))
}

async function withRepositoryLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const lock = await open(lockPath, 'wx', 0o600)
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid }))
        return await operation()
      } finally {
        await lock.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await recoverDeadRepositoryLock(lockPath)) continue
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw new Error('Memory-Control Package repository lock timed out')
}

async function recoverDeadRepositoryLock(lockPath: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown }
    if (!Number.isSafeInteger(raw.pid) || Number(raw.pid) < 1) return recoverStaleInvalidLock(lockPath)
    try {
      process.kill(Number(raw.pid), 0)
      return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
      await unlink(lockPath)
      return true
    }
  } catch {
    return recoverStaleInvalidLock(lockPath)
  }
}

async function recoverStaleInvalidLock(lockPath: string): Promise<boolean> {
  try {
    const metadata = await stat(lockPath)
    if (Date.now() - metadata.mtimeMs <= STALE_MEMORY_CONTROL_LOCK_MS) return false
    await unlink(lockPath)
    return true
  } catch {
    return false
  }
}

function decodePointer(path: string): string[] {
  if (!path.startsWith('/') || path.length > 1_024) throw new Error('Memory-Control Package patch path is invalid')
  return path.slice(1).split('/').map((part) => {
    if (/~(?:[^01]|$)/.test(part)) throw new Error('Memory-Control Package patch path is invalid')
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!decoded || ['__proto__', 'prototype', 'constructor'].includes(decoded)) throw new Error('Memory-Control Package patch path is unsafe')
    return decoded
  })
}

function validatePatch(patch: unknown): MemoryControlJsonPatchOperation[] {
  if (!Array.isArray(patch) || patch.length < 1 || patch.length > MAX_MEMORY_CONTROL_PATCH_OPERATIONS) {
    throw new Error('Memory-Control Package patch is empty or exceeds bounds')
  }
  validateBoundedJson(patch)
  if (Buffer.byteLength(canonicalJson(patch), 'utf8') > MAX_MEMORY_CONTROL_PATCH_BYTES) {
    throw new Error('Memory-Control Package patch is empty or exceeds bounds')
  }
  return patch.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory-Control Package patch operation is invalid')
    const operation = value as Record<string, unknown>
    if (Object.keys(operation).some((key) => !['op', 'path', 'value'].includes(key))
      || !['add', 'remove', 'replace'].includes(String(operation.op)) || typeof operation.path !== 'string'
      || (operation.op === 'remove' ? 'value' in operation : !('value' in operation))) {
      throw new Error('Memory-Control Package patch operation is invalid')
    }
    decodePointer(operation.path)
    return immutableClone(operation as unknown as MemoryControlJsonPatchOperation)
  })
}

function applyPatch(body: Readonly<Record<string, unknown>>, input: unknown): Readonly<Record<string, unknown>> {
  const result = structuredClone(body) as Record<string, unknown>
  for (const operation of validatePatch(input)) applyPatchOperation(result, operation)
  validateComponentBody(result)
  return result
}

function applyPatchOperation(result: Record<string, unknown>, operation: MemoryControlJsonPatchOperation): void {
  const segments = decodePointer(operation.path)
  const parent = resolvePatchParent(result, segments.slice(0, -1))
  const key = segments.at(-1)!
  if (Array.isArray(parent)) applyArrayPatch(parent, key, operation)
  else if (parent && typeof parent === 'object') applyObjectPatch(parent as Record<string, unknown>, key, operation)
  else throw new Error('Memory-Control Package patch parent is not a container')
}

function resolvePatchParent(root: Record<string, unknown>, segments: readonly string[]): unknown {
  let parent: unknown = root
  for (const segment of segments) {
    if (Array.isArray(parent)) {
      if (!/^\d+$/.test(segment) || Number(segment) >= parent.length) throw new Error('Memory-Control Package patch path is unknown')
      parent = parent[Number(segment)]
      continue
    }
    if (parent && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, segment)) {
      parent = (parent as Record<string, unknown>)[segment]
      continue
    }
    throw new Error('Memory-Control Package patch path is unknown')
  }
  return parent
}

function applyArrayPatch(parent: unknown[], key: string, operation: MemoryControlJsonPatchOperation): void {
  const index = key === '-' && operation.op === 'add' ? parent.length : Number(key)
  if (!Number.isSafeInteger(index) || index < 0 || index > parent.length
    || (operation.op !== 'add' && index >= parent.length)) throw new Error('Memory-Control Package patch array index is invalid')
  if (operation.op === 'add') parent.splice(index, 0, structuredClone(operation.value))
  else if (operation.op === 'remove') parent.splice(index, 1)
  else parent[index] = structuredClone(operation.value)
}

function applyObjectPatch(parent: Record<string, unknown>, key: string, operation: MemoryControlJsonPatchOperation): void {
  const exists = Object.prototype.hasOwnProperty.call(parent, key)
  if (operation.op === 'add') parent[key] = structuredClone(operation.value)
  else if (!exists) throw new Error('Memory-Control Package patch path is unknown')
  else if (operation.op === 'remove') delete parent[key]
  else parent[key] = structuredClone(operation.value)
}

function assertEvaluationPackageBinding(
  report: MemoryControlEvaluationReport,
  active: MemoryControlPackage,
  candidate: MemoryControlPackage,
): void {
  if (candidate.status !== 'candidate' || candidate.parentRevision !== active.revision
    || report.baselinePackage.id !== active.id || report.baselinePackage.revision !== active.revision || report.baselinePackage.digest !== active.digest
    || report.candidatePackage.id !== candidate.id || report.candidatePackage.revision !== candidate.revision || report.candidatePackage.digest !== candidate.digest) {
    throw new Error('Memory-Control evaluation report lost its compare-and-swap package binding')
  }
}

function assertEvaluationRunPairing(
  report: MemoryControlEvaluationReport,
  active: MemoryControlPackage,
  candidate: MemoryControlPackage,
): void {
  const baselineRuns = report.runs.filter((run) => run.phase === 'baseline')
  const candidateRuns = report.runs.filter((run) => run.phase === 'candidate')
  if (!baselineRuns.length && !candidateRuns.length && report.decision === 'rejected') return
  const baselineIds = new Set(baselineRuns.map((run) => run.taskId))
  if (!baselineRuns.length || baselineRuns.length !== candidateRuns.length || baselineIds.size !== baselineRuns.length
    || candidateRuns.some((run) => !baselineIds.has(run.taskId))
    || new Set(candidateRuns.map((run) => run.taskId)).size !== candidateRuns.length
    || new Set(report.runs.map((run) => run.runId)).size !== report.runs.length
    || candidateRuns.some((run) => baselineRuns.find((entry) => entry.taskId === run.taskId)?.cohort !== run.cohort)
    || baselineRuns.some((run) => run.governingPackage.revision !== active.revision || run.governingPackage.digest !== active.digest)
    || candidateRuns.some((run) => run.governingPackage.revision !== candidate.revision || run.governingPackage.digest !== candidate.digest)) {
    throw new Error('Memory-Control evaluation report run pairing or governing package is invalid')
  }
}

function aggregateEvaluationRuns(runs: readonly MemoryControlEvaluationRun[]): MemoryControlEvaluationReport['metrics'] {
  const count = runs.length || 1
  const successes = runs.filter((run) => run.metrics.taskSuccess).length
  const promptTokens = runs.reduce((sum, run) => sum + run.metrics.promptTokens, 0)
  return {
    taskSuccessRate: successes / count,
    falseDoneRate: runs.filter((run) => run.metrics.falseDone).length / count,
    requiredActionRecall: runs.reduce((sum, run) => sum + run.metrics.requiredActionRecall, 0) / count,
    skillInvocationPrecision: runs.reduce((sum, run) => sum + run.metrics.skillInvocationPrecision, 0) / count,
    skillInvocationReach: runs.reduce((sum, run) => sum + run.metrics.skillInvocationReach, 0) / count,
    promptTokens,
    tokensPerSuccess: successes ? promptTokens / successes : null,
  }
}

/** Re-derive promotion semantics inside the Host-owned repository. */
function recomputedEvaluationReasons(
  report: MemoryControlEvaluationReport,
  baseline: readonly MemoryControlEvaluationRun[],
  candidate: readonly MemoryControlEvaluationRun[],
): string[] {
  const reasons: string[] = []
  for (const run of baseline) {
    if (run.cohort === 'held-out-anchor' && !run.metrics.taskSuccess) {
      reasons.push(`${run.taskId}: held-out baseline anchor is not successful`)
    }
  }
  const sourceImproved = candidate.some((run) => {
    if (run.cohort !== 'source-failure') return false
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    return Number(run.metrics.taskSuccess) > Number(before.metrics.taskSuccess)
      || run.metrics.requiredActionRecall > before.metrics.requiredActionRecall
      || run.metrics.skillInvocationReach > before.metrics.skillInvocationReach
  })
  if (!sourceImproved) reasons.push('candidate did not improve a source-failure task')
  for (const run of candidate) {
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    if (run.metrics.falseDone) reasons.push(`${run.taskId}: false-done`)
    if (!run.metrics.taskSuccess) reasons.push(`${run.taskId}: task success requirement missed`)
    if (run.metrics.requiredActionRecall < 1 || run.metrics.requiredActionRecall < before.metrics.requiredActionRecall) {
      reasons.push(`${run.taskId}: required-action recall regression`)
    }
    if (run.metrics.skillInvocationReach < 1) reasons.push(`${run.taskId}: required Skill was missed`)
    if (run.metrics.skillInvocationPrecision < 1) reasons.push(`${run.taskId}: unjustified Skill invocation`)
    const comparativeLimit = Math.floor(before.metrics.promptTokens * (1 + report.tokenBudget.maxRegressionRatio))
    if (run.metrics.promptTokens > comparativeLimit) reasons.push(`${run.taskId}: token regression exceeded explicit budget`)
  }
  return [...new Set(reasons)]
}

function assertEvaluationSemantics(report: MemoryControlEvaluationReport): void {
  const baseline = report.runs.filter((run) => run.phase === 'baseline')
  const candidate = report.runs.filter((run) => run.phase === 'candidate')
  if (canonicalJson(aggregateEvaluationRuns(candidate)) !== canonicalJson(report.metrics)) {
    throw new Error('Memory-Control evaluation aggregate metrics do not match the paired candidate runs')
  }
  if (!baseline.length && !candidate.length) {
    if (report.decision !== 'rejected' || report.reasons.length === 0) throw new Error('Memory-Control evaluation without runs must fail closed')
    return
  }
  const requiredReasons = recomputedEvaluationReasons(report, baseline, candidate)
  if (report.decision === 'promoted' && requiredReasons.length > 0) {
    throw new Error(`Memory-Control evaluation promotion contradicts Host-recomputed semantics: ${requiredReasons.join('; ')}`)
  }
  if (report.decision === 'rejected' && requiredReasons.some((reason) => !report.reasons.includes(reason))) {
    throw new Error('Memory-Control evaluation rejection omits a Host-recomputed reason')
  }
}

function evaluationSettlementDocument(
  document: MemoryControlPackageDocument,
  rawReport: MemoryControlEvaluationReport,
): { document: MemoryControlPackageDocument; revision: number } {
  const report = validateEvaluationReport(rawReport)
  if (document.evaluations.length >= MAX_MEMORY_CONTROL_EVALUATION_REPORTS) throw new Error('Memory-Control evaluation report limit reached')
  if (document.evaluations.some((entry) => entry.reportId === report.reportId)) throw new Error('Memory-Control evaluation report is duplicated')
  const active = document.packages.find((entry) => entry.revision === document.activeRevision)!
  const candidate = document.packages.find((entry) => entry.revision === report.candidatePackage.revision)
  if (!candidate) throw new Error('Memory-Control evaluation candidate is unknown')
  assertEvaluationPackageBinding(report, active, candidate)
  assertEvaluationRunPairing(report, active, candidate)
  assertEvaluationSemantics(report)
  const reason = report.decision === 'promoted'
    ? `evaluation ${report.corpusVersion} passed; report ${report.reportId}`
    : `evaluation ${report.corpusVersion} rejected; report ${report.reportId}: ${report.reasons.join('; ')}`.slice(0, MAX_MEMORY_CONTROL_REASON_BYTES)
  const event = lifecycleEvent(document, {
    kind: report.decision === 'promoted' ? 'candidate-activated' : 'candidate-rejected',
    revision: candidate.revision, fromRevision: active.revision,
    ...(candidate.diagnosisComponent ? { diagnosisComponent: candidate.diagnosisComponent } : {}), reason,
  })
  const packages = report.decision === 'rejected'
    ? document.packages.map((entry) => entry.revision === candidate.revision ? { ...entry, status: 'rejected' as const } : entry)
    : document.packages
  const activeRevision = report.decision === 'promoted' ? candidate.revision : active.revision
  return {
    document: memoryControlPackageDocument(packages, activeRevision, [...document.events, event], [...document.evaluations, report]),
    revision: candidate.revision,
  }
}

function lifecycleEvent(
  document: MemoryControlPackageDocument,
  input: Omit<MemoryControlLifecycleEvent, 'sequence' | 'reason'> & { reason: unknown },
): MemoryControlLifecycleEvent {
  if (document.events.length >= MAX_MEMORY_CONTROL_LIFECYCLE_EVENTS) throw new Error('Memory-Control Package lifecycle history exceeds bounds')
  return immutableClone({ ...input, sequence: document.events.length + 1, reason: validateReason(input.reason) })
}

export class JsonMemoryControlPackageRepository implements MemoryControlPackageReader {
  private readonly path: string
  private document: MemoryControlPackageDocument
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(path: string, document: MemoryControlPackageDocument) {
    this.path = path
    this.document = document
  }

  static async open(path: string): Promise<JsonMemoryControlPackageRepository> {
    let source: string
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_MEMORY_CONTROL_REPOSITORY_BYTES) throw new Error('Memory-Control Package repository exceeds bounds')
      source = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const initial = memoryControlPackageDocument([BASELINE_MEMORY_CONTROL_PACKAGE], 1)
      await atomicWrite(path, initial)
      source = JSON.stringify(initial)
    }
    const document = parseDocument(source)
    const persisted = JSON.parse(source) as { activeRevision?: unknown; events?: unknown[] }
    if (persisted.activeRevision !== document.activeRevision || (persisted.events?.length || 0) !== document.events.length) {
      await atomicWrite(path, document)
    }
    return new JsonMemoryControlPackageRepository(path, document)
  }

  admitActive(): MemoryControlPackage {
    return this.read({ schemaVersion: 1, revision: this.document.activeRevision })
  }

  read(input: { schemaVersion: 1; revision?: number }): MemoryControlPackage {
    if (input.schemaVersion !== 1) throw new Error('Unsupported Memory-Control Package schema version')
    const revision = input.revision ?? this.document.activeRevision
    const found = this.document.packages.find((entry) => entry.revision === revision)
    if (!found) throw new Error(`Unknown Memory-Control Package revision: ${revision}`)
    return immutableClone(found)
  }

  lineage(): MemoryControlLineage {
    const evaluated = new Set(this.document.evaluations.filter((report) => report.decision === 'promoted').map((report) => report.candidatePackage.revision))
    const legacyActivated = new Set(this.document.events.filter((event) => event.kind === 'candidate-activated' && !evaluated.has(event.revision)).map((event) => event.revision))
    return immutableClone({
      activeRevision: this.document.activeRevision,
      packages: this.document.packages.map(({ id, revision, parentRevision, diagnosisComponent, digest, status }) => ({
        id, revision, ...(parentRevision === undefined ? {} : { parentRevision }),
        ...(diagnosisComponent === undefined ? {} : { diagnosisComponent }), digest, status,
        qualification: revision === 1 ? 'baseline' : evaluated.has(revision) ? 'evaluated' : legacyActivated.has(revision) ? 'legacy-unqualified' : 'unevaluated',
      })),
      events: this.document.events,
    })
  }

  evaluationReports(): ReadonlyArray<MemoryControlEvaluationReport> {
    return immutableClone(this.document.evaluations)
  }

  createCandidate(input: {
    expectedActiveRevision: number
    diagnosisComponent: MemoryControlComponentKey
    patch: readonly MemoryControlJsonPatchOperation[]
    reason: string
  }): Promise<MemoryControlPackage> {
    return this.mutate(async () => {
      if (!MEMORY_CONTROL_COMPONENT_KEYS.includes(input.diagnosisComponent)) throw new Error('Memory-Control Package diagnosis component is invalid')
      if (this.document.activeRevision !== input.expectedActiveRevision) throw new Error('Memory-Control Package active revision changed')
      if (this.document.packages.length >= MAX_MEMORY_CONTROL_PACKAGES) throw new Error('Memory-Control Package repository package limit reached')
      const parent = this.read({ schemaVersion: 1, revision: input.expectedActiveRevision })
      const body = applyPatch(parent.components[input.diagnosisComponent].body, input.patch)
      const nextRevision = Math.max(...this.document.packages.map((entry) => entry.revision)) + 1
      const diagnosed = parent.components[input.diagnosisComponent]
      const candidate = createMemoryControlPackage({
        id: parent.id,
        revision: nextRevision,
        parentRevision: parent.revision,
        diagnosisComponent: input.diagnosisComponent,
        status: 'candidate',
        components: {
          ...parent.components,
          [input.diagnosisComponent]: { id: diagnosed.id, revision: diagnosed.revision + 1, body },
        },
      })
      for (const key of MEMORY_CONTROL_COMPONENT_KEYS) {
        if (key !== input.diagnosisComponent && candidate.components[key].digest !== parent.components[key].digest) {
          throw new Error('Memory-Control Package candidate changed an undiagnosed component')
        }
      }
      const event = lifecycleEvent(this.document, {
        kind: 'candidate-created', revision: candidate.revision, fromRevision: parent.revision,
        diagnosisComponent: input.diagnosisComponent, reason: input.reason,
      })
      await this.commit(memoryControlPackageDocument([...this.document.packages, candidate], this.document.activeRevision, [...this.document.events, event], this.document.evaluations))
      return this.read({ schemaVersion: 1, revision: candidate.revision })
    })
  }

  rejectCandidate(input: { revision: number; reason: string }): Promise<MemoryControlPackage> {
    return this.mutate(async () => {
      const candidate = this.read({ schemaVersion: 1, revision: input.revision })
      if (candidate.status !== 'candidate') throw new Error('Memory-Control Package revision is not a candidate')
      const packages = this.document.packages.map((entry) => entry.revision === input.revision ? { ...entry, status: 'rejected' as const } : entry)
      const event = lifecycleEvent(this.document, {
        kind: 'candidate-rejected', revision: candidate.revision,
        ...(candidate.parentRevision ? { fromRevision: candidate.parentRevision } : {}),
        ...(candidate.diagnosisComponent ? { diagnosisComponent: candidate.diagnosisComponent } : {}), reason: input.reason,
      })
      await this.commit(memoryControlPackageDocument(packages, this.document.activeRevision, [...this.document.events, event], this.document.evaluations))
      return this.read({ schemaVersion: 1, revision: input.revision })
    })
  }

  settleEvaluation(input: { report: MemoryControlEvaluationReport }): Promise<MemoryControlPackage> {
    return this.mutate(async () => {
      const settled = evaluationSettlementDocument(this.document, input.report)
      compileMemoryControlRuntime(settled.document.packages.find((entry) => entry.revision === settled.document.activeRevision)!)
      await this.commit(settled.document)
      return this.read({ schemaVersion: 1, revision: settled.revision })
    })
  }

  rollback(input: { revision: number; expectedActiveRevision: number; reason: string }): Promise<MemoryControlPackage> {
    return this.mutate(async () => {
      if (this.document.activeRevision !== input.expectedActiveRevision) throw new Error('Memory-Control Package rollback lost its compare-and-swap race')
      const target = this.read({ schemaVersion: 1, revision: input.revision })
      const wasPreviouslyActive = target.revision === 1 || this.document.evaluations.some((report) =>
        report.decision === 'promoted' && report.candidatePackage.revision === target.revision)
      if (!wasPreviouslyActive) throw new Error('Memory-Control Package rollback target was never validated and active')
      compileMemoryControlRuntime(target)
      const event = lifecycleEvent(this.document, {
        kind: 'rollback', revision: target.revision, fromRevision: this.document.activeRevision, reason: input.reason,
      })
      await this.commit(memoryControlPackageDocument(this.document.packages, target.revision, [...this.document.events, event], this.document.evaluations))
      return this.admitActive()
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(() => withRepositoryLock(this.path, async () => {
      this.document = await readDocument(this.path)
      return operation()
    }))
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async commit(document: MemoryControlPackageDocument): Promise<void> {
    const validated = parseDocument(JSON.stringify(document))
    await atomicWrite(this.path, validated)
    this.document = validated
  }
}

export function baselineMemoryControlPackageReader(): MemoryControlPackageReader {
  return {
    admitActive: () => immutableClone(BASELINE_MEMORY_CONTROL_PACKAGE),
    read: (input) => {
      if (input.schemaVersion !== 1) throw new Error('Unsupported Memory-Control Package schema version')
      if (input.revision !== undefined && input.revision !== 1) throw new Error(`Unknown Memory-Control Package revision: ${input.revision}`)
      return immutableClone(BASELINE_MEMORY_CONTROL_PACKAGE)
    },
    lineage: () => immutableClone({
      activeRevision: 1,
      packages: [{
        id: BASELINE_MEMORY_CONTROL_PACKAGE.id,
        revision: 1,
        digest: BASELINE_MEMORY_CONTROL_PACKAGE.digest,
        status: 'active' as const,
        qualification: 'baseline' as const,
      }],
      events: [],
    }),
    evaluationReports: () => [],
  }
}
