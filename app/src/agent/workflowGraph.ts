export const WORKFLOW_GRAPH_CAPABILITY = 'workflow-graph-v1' as const

export type WorkflowNodeKind = 'agent' | 'deterministic-reducer' | 'verifier' | 'human-gate'
export type WorkflowWorkspaceMode = 'shared-readonly' | 'shared-leased-write' | 'isolated-worktree'
export type WorkflowRetryReason = 'execution-failed' | 'schema-failed' | 'criterion-failed'

export type WorkflowNode = Readonly<{
  id: string
  kind: WorkflowNodeKind
  task: string
  dependsOn: readonly string[]
  /** A control-only dependency is explicit; otherwise dependsOn must bind an input artifact. */
  barrier?: Readonly<{ justification: string }>
  inputs: readonly Readonly<{ name: string; artifactRef: string; required: boolean }>[]
  outputs: readonly Readonly<{ id: string; schemaId: string; required: boolean }>[]
  runner: Readonly<{
    preferred?: string
    requiredCapabilities: readonly string[]
    workspaceMode: WorkflowWorkspaceMode
    /** Required bounded project-relative scopes for shared writers. */
    workspaceScopes?: readonly string[]
  }>
  verifier?: Readonly<{
    freshContext: boolean
    rubricId?: string
    quorum?: Readonly<{ pass: number; total: number }>
  }>
  retry: Readonly<{
    maxAttempts: number
    retryOn: readonly WorkflowRetryReason[]
  }>
}>

export type WorkflowDefinition = Readonly<{
  schemaVersion: 1
  id: string
  revision: number
  digest: string
  nodes: readonly WorkflowNode[]
  terminalNodeIds: readonly string[]
  budgets: Readonly<{
    maxConcurrentNodes: number
    maxTotalAttempts: number
    maxWallClockMs: number
  }>
}>

export type WorkflowDefinitionInput = Omit<WorkflowDefinition, 'digest'> & { digest?: string }
export type WorkflowValidationIssue = Readonly<{
  code: string
  path: string
  message: string
}>
export type WorkflowValidationResult = Readonly<{
  ok: boolean
  errors: readonly WorkflowValidationIssue[]
  warnings: readonly WorkflowValidationIssue[]
  definition?: WorkflowDefinition
}>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SHA256 = /^[a-f0-9]{64}$/
const NODE_KINDS = new Set<WorkflowNodeKind>(['agent', 'deterministic-reducer', 'verifier', 'human-gate'])
const WORKSPACE_MODES = new Set<WorkflowWorkspaceMode>(['shared-readonly', 'shared-leased-write', 'isolated-worktree'])
const RETRY_REASONS = new Set<WorkflowRetryReason>(['execution-failed', 'schema-failed', 'criterion-failed'])

const issue = (code: string, path: string, message: string): WorkflowValidationIssue => ({ code, path, message })
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const validText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const integerBetween = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (record(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function validInput(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['name', 'artifactRef', 'required'])) return false
  return validId(value.name) && validId(value.artifactRef) && typeof value.required === 'boolean'
}

function validOutput(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['id', 'schemaId', 'required'])) return false
  return validId(value.id) && validId(value.schemaId) && typeof value.required === 'boolean'
}

function validRunner(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['preferred', 'requiredCapabilities', 'workspaceMode', 'workspaceScopes'])) return false
  if (value.preferred !== undefined && !validId(value.preferred)) return false
  if (!Array.isArray(value.requiredCapabilities) || value.requiredCapabilities.length > 64) return false
  if (!value.requiredCapabilities.every(validId)) return false
  if (new Set(value.requiredCapabilities).size !== value.requiredCapabilities.length) return false
  if (!WORKSPACE_MODES.has(value.workspaceMode as WorkflowWorkspaceMode)) return false
  if (value.workspaceScopes !== undefined && (!Array.isArray(value.workspaceScopes)
    || value.workspaceScopes.length > 100
    || !value.workspaceScopes.every((scope) => typeof scope === 'string'
      && scope.length > 0 && scope.length <= 2_048 && !/^[/\\]|^[A-Za-z]:[/\\]/.test(scope)
      && !scope.split(/[\\/]/).includes('..'))
    || new Set(value.workspaceScopes).size !== value.workspaceScopes.length)) return false
  if (value.workspaceMode === 'shared-leased-write' && (!Array.isArray(value.workspaceScopes) || value.workspaceScopes.length === 0)) return false
  return true
}

function validVerifier(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['freshContext', 'rubricId', 'quorum'])) return false
  if (typeof value.freshContext !== 'boolean') return false
  if (value.rubricId !== undefined && !validId(value.rubricId)) return false
  if (value.quorum === undefined) return true
  if (!record(value.quorum) || !exactKeys(value.quorum, ['pass', 'total'])) return false
  return integerBetween(value.quorum.total, 1, 9)
    && integerBetween(value.quorum.pass, 1, Number(value.quorum.total))
}

function validRetry(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['maxAttempts', 'retryOn'])) return false
  if (!integerBetween(value.maxAttempts, 1, 100) || !Array.isArray(value.retryOn)) return false
  if (value.retryOn.length > RETRY_REASONS.size || !value.retryOn.every((item) => RETRY_REASONS.has(item as WorkflowRetryReason))) return false
  return new Set(value.retryOn).size === value.retryOn.length
}

function validBarrier(value: unknown): boolean {
  return record(value) && exactKeys(value, ['justification']) && validText(value.justification, 500)
}

function validateNodeShape(value: unknown, index: number): WorkflowValidationIssue[] {
  const path = `nodes[${index}]`
  if (!record(value)) return [issue('invalid-node', path, 'Workflow node must be an object')]
  const errors: WorkflowValidationIssue[] = []
  if (!exactKeys(value, ['id', 'kind', 'task', 'dependsOn', 'barrier', 'inputs', 'outputs', 'runner', 'verifier', 'retry'])) errors.push(issue('unknown-node-field', path, 'Workflow node contains an unknown field'))
  if (!validId(value.id)) errors.push(issue('invalid-node-id', `${path}.id`, 'Node id is invalid'))
  if (!NODE_KINDS.has(value.kind as WorkflowNodeKind)) errors.push(issue('invalid-node-kind', `${path}.kind`, 'Node kind is invalid'))
  if (!validText(value.task, 4_000)) errors.push(issue('invalid-task', `${path}.task`, 'Node task is required and bounded'))
  if (!Array.isArray(value.dependsOn) || !value.dependsOn.every(validId)) errors.push(issue('invalid-dependencies', `${path}.dependsOn`, 'dependsOn must contain valid node ids'))
  if (value.barrier !== undefined && !validBarrier(value.barrier)) errors.push(issue('invalid-barrier', `${path}.barrier`, 'Barrier requires a bounded justification'))
  if (!Array.isArray(value.inputs) || value.inputs.length > 100 || !value.inputs.every(validInput)) errors.push(issue('invalid-inputs', `${path}.inputs`, 'Node inputs are invalid'))
  if (!Array.isArray(value.outputs) || value.outputs.length > 100 || !value.outputs.every(validOutput)) errors.push(issue('invalid-outputs', `${path}.outputs`, 'Node outputs are invalid'))
  if (!validRunner(value.runner)) errors.push(issue('invalid-runner', `${path}.runner`, 'Runner policy is invalid'))
  if (value.verifier !== undefined && !validVerifier(value.verifier)) errors.push(issue('invalid-verifier', `${path}.verifier`, 'Verifier policy is invalid'))
  if (!validRetry(value.retry)) errors.push(issue('invalid-retry', `${path}.retry`, 'Retry policy is invalid'))
  return errors
}

function validateDefinitionShape(value: unknown): WorkflowValidationIssue[] {
  if (!record(value)) return [issue('invalid-definition', '$', 'Workflow definition must be an object')]
  const errors: WorkflowValidationIssue[] = []
  if (!exactKeys(value, ['schemaVersion', 'id', 'revision', 'digest', 'nodes', 'terminalNodeIds', 'budgets'])) errors.push(issue('unknown-definition-field', '$', 'Workflow definition contains an unknown field'))
  if (value.schemaVersion !== 1) errors.push(issue('invalid-schema-version', 'schemaVersion', 'schemaVersion must be 1'))
  if (!validId(value.id)) errors.push(issue('invalid-workflow-id', 'id', 'Workflow id is invalid'))
  if (!integerBetween(value.revision, 1, 1_000_000)) errors.push(issue('invalid-revision', 'revision', 'Workflow revision is invalid'))
  if (value.digest !== undefined && (typeof value.digest !== 'string' || !SHA256.test(value.digest))) errors.push(issue('invalid-digest', 'digest', 'Workflow digest must be SHA-256'))
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 500) errors.push(issue('invalid-node-count', 'nodes', 'Workflow must contain 1..500 nodes'))
  else value.nodes.forEach((node, index) => errors.push(...validateNodeShape(node, index)))
  if (!Array.isArray(value.terminalNodeIds) || value.terminalNodeIds.length < 1 || !value.terminalNodeIds.every(validId)) errors.push(issue('invalid-terminals', 'terminalNodeIds', 'At least one valid terminal node is required'))
  if (!record(value.budgets)) errors.push(issue('invalid-budgets', 'budgets', 'Workflow budgets are required'))
  return errors
}

function validateBudgets(definition: WorkflowDefinitionInput): WorkflowValidationIssue[] {
  const budgets = definition.budgets as Record<string, unknown>
  const errors: WorkflowValidationIssue[] = []
  if (!exactKeys(budgets, ['maxConcurrentNodes', 'maxTotalAttempts', 'maxWallClockMs'])) errors.push(issue('unknown-budget-field', 'budgets', 'Workflow budgets contain an unknown field'))
  if (!integerBetween(budgets.maxConcurrentNodes, 1, 64) || Number(budgets.maxConcurrentNodes) > definition.nodes.length) errors.push(issue('invalid-concurrency-budget', 'budgets.maxConcurrentNodes', 'Concurrency must be between 1 and the node count'))
  if (!integerBetween(budgets.maxTotalAttempts, definition.nodes.length, 10_000)) errors.push(issue('invalid-attempt-budget', 'budgets.maxTotalAttempts', 'Attempt budget must cover every node once and remain bounded'))
  if (!integerBetween(budgets.maxWallClockMs, 1_000, 7 * 24 * 60 * 60 * 1_000)) errors.push(issue('invalid-wall-clock-budget', 'budgets.maxWallClockMs', 'Wall-clock budget must be between 1 second and 7 days'))
  return errors
}

function outputOwners(nodes: readonly WorkflowNode[], errors: WorkflowValidationIssue[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const node of nodes) {
    for (const output of node.outputs) {
      const owner = owners.get(output.id)
      if (owner) errors.push(issue('duplicate-output', `nodes.${node.id}.outputs`, `Artifact ${output.id} is already produced by ${owner}`))
      else owners.set(output.id, node.id)
    }
  }
  return owners
}

function dependencyErrors(nodes: readonly WorkflowNode[], owners: ReadonlyMap<string, string>): WorkflowValidationIssue[] {
  const errors: WorkflowValidationIssue[] = []
  const ids = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) errors.push(issue('duplicate-dependency', `nodes.${node.id}.dependsOn`, 'Dependencies must be unique'))
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) errors.push(issue('missing-dependency', `nodes.${node.id}.dependsOn`, `Dependency ${dependency} does not exist`))
      if (dependency === node.id) errors.push(issue('self-dependency', `nodes.${node.id}.dependsOn`, 'A node cannot depend on itself'))
    }
    for (const input of node.inputs) {
      const owner = owners.get(input.artifactRef)
      if (!owner) errors.push(issue('missing-artifact-ref', `nodes.${node.id}.inputs.${input.name}`, `Artifact ${input.artifactRef} has no producer`))
      else if (!node.dependsOn.includes(owner)) errors.push(issue('unbound-artifact-dependency', `nodes.${node.id}.inputs.${input.name}`, `Artifact producer ${owner} must be a direct dependency`))
    }
  }
  return errors
}

function cycleErrors(nodes: readonly WorkflowNode[]): WorkflowValidationIssue[] {
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const node of nodes) for (const dependency of node.dependsOn) {
    if (!indegree.has(dependency)) continue
    indegree.set(node.id, (indegree.get(node.id) || 0) + 1)
    outgoing.get(dependency)?.push(node.id)
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index]
    visited += 1
    for (const next of outgoing.get(id) || []) {
      const remaining = (indegree.get(next) || 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) ready.push(next)
    }
  }
  return visited === nodes.length ? [] : [issue('dependency-cycle', 'nodes', 'Workflow dependencies contain a cycle')]
}

function terminalErrors(nodes: readonly WorkflowNode[], terminalNodeIds: readonly string[]): WorkflowValidationIssue[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const errors = terminalNodeIds.filter((id) => !byId.has(id)).map((id) => issue('missing-terminal', 'terminalNodeIds', `Terminal node ${id} does not exist`))
  const reachesTerminal = new Set(terminalNodeIds.filter((id) => byId.has(id)))
  const queue = [...reachesTerminal]
  for (let index = 0; index < queue.length; index += 1) {
    for (const dependency of byId.get(queue[index])?.dependsOn || []) {
      if (reachesTerminal.has(dependency)) continue
      reachesTerminal.add(dependency)
      queue.push(dependency)
    }
  }
  for (const node of nodes) if (!reachesTerminal.has(node.id)) errors.push(issue('unreachable-terminal', `nodes.${node.id}`, `Node ${node.id} cannot reach a declared terminal`))
  return errors
}

function workspaceErrors(nodes: readonly WorkflowNode[]): WorkflowValidationIssue[] {
  return nodes
    .filter((node) => node.kind !== 'agent' && node.runner.workspaceMode !== 'shared-readonly')
    .map((node) => issue('invalid-workspace-policy', `nodes.${node.id}.runner.workspaceMode`, `${node.kind} nodes must use shared-readonly`))
}

function fakeEdgeWarnings(nodes: readonly WorkflowNode[], owners: ReadonlyMap<string, string>): WorkflowValidationIssue[] {
  const warnings: WorkflowValidationIssue[] = []
  for (const node of nodes) for (const dependency of node.dependsOn) {
    const hasBinding = node.inputs.some((input) => owners.get(input.artifactRef) === dependency)
    if (!hasBinding && !node.barrier) warnings.push(issue('fake-edge', `nodes.${node.id}.dependsOn`, `Dependency ${dependency} has no input binding or barrier justification`))
  }
  return warnings
}

function graphValidation(definition: WorkflowDefinitionInput): { errors: WorkflowValidationIssue[]; warnings: WorkflowValidationIssue[] } {
  const errors: WorkflowValidationIssue[] = []
  const nodeIds = definition.nodes.map((node) => node.id)
  if (new Set(nodeIds).size !== nodeIds.length) errors.push(issue('duplicate-node-id', 'nodes', 'Node ids must be unique'))
  if (new Set(definition.terminalNodeIds).size !== definition.terminalNodeIds.length) errors.push(issue('duplicate-terminal', 'terminalNodeIds', 'Terminal node ids must be unique'))
  const owners = outputOwners(definition.nodes, errors)
  errors.push(...dependencyErrors(definition.nodes, owners))
  errors.push(...cycleErrors(definition.nodes))
  errors.push(...terminalErrors(definition.nodes, definition.terminalNodeIds))
  errors.push(...workspaceErrors(definition.nodes))
  errors.push(...validateBudgets(definition))
  return { errors, warnings: fakeEdgeWarnings(definition.nodes, owners) }
}

export async function validateAndFreezeWorkflowDefinition(value: unknown): Promise<WorkflowValidationResult> {
  const shapeErrors = validateDefinitionShape(value)
  if (shapeErrors.length || !record(value)) return freezeDeep({ ok: false, errors: shapeErrors, warnings: [] })
  const input = structuredClone(value) as WorkflowDefinitionInput
  const graph = graphValidation(input)
  if (graph.errors.length) return freezeDeep({ ok: false, errors: graph.errors, warnings: graph.warnings })
  const { digest: claimedDigest, ...body } = input
  const digest = await sha256(canonicalJson(body))
  if (claimedDigest && claimedDigest !== digest) {
    return freezeDeep({ ok: false, errors: [issue('digest-mismatch', 'digest', 'Claimed workflow digest does not match its canonical body')], warnings: graph.warnings })
  }
  const definition = freezeDeep({ ...body, digest }) as WorkflowDefinition
  return freezeDeep({ ok: true, errors: [], warnings: graph.warnings, definition })
}

export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!record(value) || typeof value.digest !== 'string' || !SHA256.test(value.digest)) return false
  if (validateDefinitionShape(value).length > 0) return false
  return graphValidation(value as WorkflowDefinition).errors.length === 0
}
