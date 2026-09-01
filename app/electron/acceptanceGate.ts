import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  createAcceptanceEvidence,
  createAcceptanceSnapshot,
  type AcceptanceEvidence,
  type AcceptanceSnapshot,
  type CriterionVerdict,
} from '../src/agent/acceptanceContract.ts'
import type { GoalContractSnapshot, GoalCriterion } from '../src/agent/goalContract.ts'
import type { GoalVerdict } from '../src/agent/goalOutcome.ts'
import type { PiTurnSettlement } from '../src/agent/piHostRun.ts'
import { checkArtifactContract } from './criterionCheckers/artifactSchema.ts'
import {
  executeRegisteredVerificationCommand,
  TEST_SUITE_COMMAND_IDS,
  type RegisteredCommandExecution,
} from './criterionCheckers/registeredCommand.ts'
import {
  checkRevisionBoundReviewVerification,
  type ReviewVerificationBinding,
} from './criterionCheckers/reviewVerification.ts'

type RegisteredCommandState = 'matched' | 'exit-code-mismatch' | 'unknown-command' | 'unavailable' | 'revision-drift'

function registeredCommandState(execution: RegisteredCommandExecution, expectedExitCode: number): RegisteredCommandState {
  if (execution.unavailableReason?.includes('not present in the Host registry')) return 'unknown-command'
  if (execution.exitCode === undefined) return 'unavailable'
  if (execution.workspaceRevision && execution.finalWorkspaceRevision
    && execution.workspaceRevision !== execution.finalWorkspaceRevision) return 'revision-drift'
  return execution.exitCode === expectedExitCode ? 'matched' : 'exit-code-mismatch'
}

const digestText = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const within = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function checkAssistantAnswer(input: {
  criterion: Extract<GoalCriterion, { kind: 'assistant-answer-present' }>
  contract: GoalContractSnapshot
  settlement: PiTurnSettlement
  answer: string
  observedAt: number
}): Promise<{ evidence: AcceptanceEvidence; verdict: CriterionVerdict }> {
  const present = input.contract.mode === 'turn' && input.settlement === 'answered' && input.answer.trim().length > 0
  const state = input.contract.mode === 'turn' ? (present ? 'present' : 'absent') : 'not-applicable'
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${input.observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt: input.observedAt,
    kind: 'assistant-answer-present',
    state,
    ...(present ? { answerSha256: digestText(input.answer) } : {}),
  })
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: present ? 'passed' : 'failed',
      evidenceRefs: [evidence.id],
      reason: present ? 'Host observed a non-empty answered turn' : 'A non-empty answered turn was not observed in turn mode',
      repairHint: present ? undefined : 'Return a non-empty final answer in turn mode',
      retryable: !present,
    },
  }
}

async function checkFileContent(input: {
  criterion: Extract<GoalCriterion, { kind: 'file-content' }>
  workspaceRoot: string
  observedAt: number
  previousEvidence?: AcceptanceEvidence
}): Promise<{ evidence: AcceptanceEvidence; verdict: CriterionVerdict }> {
  const root = await realpath(input.workspaceRoot)
  const rawPath = input.criterion.path.startsWith('@') ? input.criterion.path.slice(1) : input.criterion.path
  const candidate = resolve(root, rawPath)
  let state: Extract<AcceptanceEvidence, { kind: 'file-content' }>['state'] = 'missing'
  let actualSha256: string | undefined
  let recordedPath = candidate
  if (!within(root, candidate)) {
    state = 'invalid-path'
  } else {
    try {
      const canonical = await realpath(candidate)
      recordedPath = canonical
      if (!within(root, canonical)) state = 'invalid-path'
      else {
        actualSha256 = digestText(await readFile(canonical))
        state = actualSha256 === input.criterion.sha256 ? 'matched' : 'mismatched'
      }
    } catch {
      state = 'missing'
    }
  }
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${input.observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt: input.observedAt,
    kind: 'file-content',
    state,
    path: recordedPath,
    expectedSha256: input.criterion.sha256,
    ...(actualSha256 ? { actualSha256 } : {}),
  })
  const previouslyMatched = input.previousEvidence?.kind === 'file-content'
    && input.previousEvidence.criterionId === input.criterion.id
    && input.previousEvidence.state === 'matched'
  const passed = state === 'matched'
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: passed ? 'passed' : previouslyMatched ? 'invalidated' : 'failed',
      evidenceRefs: [evidence.id],
      reason: passed ? 'Host content digest matches the Goal Contract'
        : previouslyMatched ? 'Previously accepted file content has drifted'
          : `Host file-content check returned ${state}`,
      repairHint: passed ? undefined : `Restore ${input.criterion.path} to sha256 ${input.criterion.sha256}`,
      retryable: !passed && state !== 'invalid-path',
    },
  }
}

async function checkRegisteredCommand(input: {
  criterion: Extract<GoalCriterion, { kind: 'registered-command' | 'test-suite' }>
  workspaceRoot: string
  observedAt: number
  run?: (input: { registryId: string; workspaceRoot: string }) => Promise<RegisteredCommandExecution>
}): Promise<{ evidence: AcceptanceEvidence; verdict: CriterionVerdict }> {
  const registryId = input.criterion.kind === 'test-suite'
    ? TEST_SUITE_COMMAND_IDS[input.criterion.suite]
    : input.criterion.commandId
  const expectedExitCode = input.criterion.kind === 'test-suite' ? 0 : input.criterion.expectedExitCode
  const execution = await (input.run || executeRegisteredVerificationCommand)({ registryId, workspaceRoot: input.workspaceRoot })
  const state = registeredCommandState(execution, expectedExitCode)
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${input.observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt: input.observedAt,
    kind: input.criterion.kind,
    state,
    registryId,
    command: execution.command,
    args: [...execution.args],
    cwd: execution.cwd,
    expectedExitCode,
    ...(execution.workspaceRevision ? { workspaceRevision: execution.workspaceRevision } : {}),
    ...(execution.finalWorkspaceRevision ? { finalWorkspaceRevision: execution.finalWorkspaceRevision } : {}),
    ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
    ...(execution.outputSha256 ? { outputSha256: execution.outputSha256 } : {}),
  })
  const passed = state === 'matched'
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: passed ? 'passed' : 'failed',
      evidenceRefs: [evidence.id],
      reason: passed
        ? `Host registry command ${registryId} exited with ${expectedExitCode} at the bound workspace revision`
        : execution.unavailableReason || `Host registry command ${registryId} returned ${state}`,
      repairHint: passed ? undefined : state === 'exit-code-mismatch'
        ? `Repair the failures reported by ${registryId}` : undefined,
      retryable: state === 'exit-code-mismatch' || state === 'unavailable',
    },
  }
}

async function checkArtifact(input: {
  criterion: Extract<GoalCriterion, { kind: 'artifact-exists' | 'json-schema' }>
  workspaceRoot: string
  observedAt: number
}): Promise<{ evidence: AcceptanceEvidence; verdict: CriterionVerdict }> {
  const check = await checkArtifactContract({ criterion: input.criterion, workspaceRoot: input.workspaceRoot })
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${input.observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt: input.observedAt,
    kind: input.criterion.kind,
    state: check.state,
    artifactId: input.criterion.artifactId,
    path: check.path,
    ...(input.criterion.kind === 'json-schema' ? { schemaId: input.criterion.schemaId } : {}),
    ...(input.criterion.kind === 'artifact-exists' && input.criterion.sha256 ? { expectedSha256: input.criterion.sha256 } : {}),
    ...(check.actualSha256 ? { actualSha256: check.actualSha256 } : {}),
    ...(check.validationErrorSha256 ? { validationErrorSha256: check.validationErrorSha256 } : {}),
  })
  const passed = check.state === 'matched'
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: passed ? 'passed' : 'failed',
      evidenceRefs: [evidence.id],
      reason: passed ? `Host validated artifact ${input.criterion.artifactId}`
        : `Host artifact check returned ${check.state}`,
      repairHint: passed ? undefined : check.state === 'schema-mismatch' || check.state === 'invalid-json'
        ? `Publish ${input.criterion.artifactId} as valid ${input.criterion.kind === 'json-schema' ? input.criterion.schemaId : 'JSON'}`
        : check.state === 'missing' ? `Publish required artifact ${input.criterion.artifactId}` : undefined,
      retryable: !['invalid-path', 'unknown-schema'].includes(check.state),
    },
  }
}

async function checkReviewVerification(input: {
  criterion: Extract<GoalCriterion, { kind: 'review-verification' }>
  observedAt: number
  binding?: ReviewVerificationBinding
}): Promise<{ evidence: AcceptanceEvidence; verdict: CriterionVerdict }> {
  const check = checkRevisionBoundReviewVerification({ criterion: input.criterion, binding: input.binding })
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${input.observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt: input.observedAt,
    kind: 'review-verification',
    state: check.state,
    snapshotId: input.criterion.snapshotId,
    verification: input.criterion.verification,
    expectedRevision: input.criterion.verifiedRevision,
    ...(check.snapshotRevision ? { snapshotRevision: check.snapshotRevision } : {}),
    ...(check.verification ? {
      verificationId: check.verification.id,
      verifiedRevision: check.verification.verifiedRevision,
      ...(check.verification.exitCode === undefined ? {} : { exitCode: check.verification.exitCode }),
    } : {}),
  })
  const passed = check.state === 'matched'
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: passed ? 'passed' : 'failed',
      evidenceRefs: [evidence.id],
      reason: passed
        ? `Historical review verification ${input.criterion.verification} passed for immutable revision ${input.criterion.verifiedRevision}`
        : `Historical review verification returned ${check.state}`,
      repairHint: passed ? undefined : check.state === 'verification-failed'
        ? `Repair the ${input.criterion.verification} failures and create a new review snapshot revision` : undefined,
      retryable: check.state === 'verification-failed' || check.state === 'verification-missing' || check.state === 'snapshot-not-ready',
    },
  }
}

type AcceptanceCheck = { evidence: AcceptanceEvidence; verdict: CriterionVerdict }

async function checkCriterion(input: {
  criterion: GoalCriterion
  goalContract: GoalContractSnapshot
  workspaceRoot: string
  settlement: PiTurnSettlement
  answer: string
  observedAt: number
  previousEvidence?: AcceptanceEvidence
  runRegisteredCommand?: (input: { registryId: string; workspaceRoot: string }) => Promise<RegisteredCommandExecution>
  reviewBindings?: Readonly<Record<string, ReviewVerificationBinding>>
}): Promise<AcceptanceCheck> {
  if (input.criterion.kind === 'assistant-answer-present') return checkAssistantAnswer({
    criterion: input.criterion, contract: input.goalContract, settlement: input.settlement,
    answer: input.answer, observedAt: input.observedAt,
  })
  if (input.criterion.kind === 'file-content') return checkFileContent({
    criterion: input.criterion, workspaceRoot: input.workspaceRoot, observedAt: input.observedAt,
    previousEvidence: input.previousEvidence,
  })
  if (input.criterion.kind === 'registered-command' || input.criterion.kind === 'test-suite') return checkRegisteredCommand({
    criterion: input.criterion, workspaceRoot: input.workspaceRoot, observedAt: input.observedAt,
    run: input.runRegisteredCommand,
  })
  if (input.criterion.kind === 'artifact-exists' || input.criterion.kind === 'json-schema') return checkArtifact({
    criterion: input.criterion, workspaceRoot: input.workspaceRoot, observedAt: input.observedAt,
  })
  return checkReviewVerification({
    criterion: input.criterion,
    observedAt: input.observedAt,
    binding: input.reviewBindings?.[input.criterion.snapshotId],
  })
}

export async function evaluateAcceptanceGate(input: {
  runId: string
  iteration: number
  goalContract: GoalContractSnapshot
  workspaceRoot: string
  settlement: PiTurnSettlement
  answer: string
  previousEvidence?: readonly AcceptanceEvidence[]
  runRegisteredCommand?: (input: { registryId: string; workspaceRoot: string }) => Promise<RegisteredCommandExecution>
  reviewBindings?: Readonly<Record<string, ReviewVerificationBinding>>
}): Promise<{ snapshot: AcceptanceSnapshot; evidence: readonly AcceptanceEvidence[] }> {
  const observedAt = Date.now()
  const checks = await Promise.all(input.goalContract.criteria.map((criterion) => checkCriterion({
    criterion,
    goalContract: input.goalContract,
    workspaceRoot: input.workspaceRoot,
    settlement: input.settlement,
    answer: input.answer,
    observedAt,
    previousEvidence: input.previousEvidence?.find((evidence) => evidence.criterionId === criterion.id),
    runRegisteredCommand: input.runRegisteredCommand,
    reviewBindings: input.reviewBindings,
  })))
  const evidence = checks.map((check) => check.evidence)
  const snapshot = await createAcceptanceSnapshot({
    runId: input.runId,
    iteration: input.iteration,
    goalContract: input.goalContract,
    verdicts: checks.map(({ verdict }) => verdict),
  })
  return { snapshot, evidence }
}

export function goalVerdictFromAcceptance(input: {
  mode: GoalContractSnapshot['mode']
  snapshot: AcceptanceSnapshot
}): GoalVerdict {
  if (input.mode === 'turn') return 'not-applicable'
  if (input.snapshot.overall === 'passed') return 'passed'
  if (input.snapshot.overall === 'unverifiable') return 'unverifiable'
  if (input.snapshot.overall === 'blocked') return 'blocked'
  if (input.snapshot.overall === 'failed') return 'failed'
  return 'exhausted'
}
