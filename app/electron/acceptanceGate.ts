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

export async function evaluateAcceptanceGate(input: {
  runId: string
  iteration: number
  goalContract: GoalContractSnapshot
  workspaceRoot: string
  settlement: PiTurnSettlement
  answer: string
  previousEvidence?: readonly AcceptanceEvidence[]
}): Promise<{ snapshot: AcceptanceSnapshot; evidence: readonly AcceptanceEvidence[] }> {
  const observedAt = Date.now()
  const checks = await Promise.all(input.goalContract.criteria.map((criterion) => criterion.kind === 'assistant-answer-present'
    ? checkAssistantAnswer({ criterion, contract: input.goalContract, settlement: input.settlement, answer: input.answer, observedAt })
    : checkFileContent({
        criterion,
        workspaceRoot: input.workspaceRoot,
        observedAt,
        previousEvidence: input.previousEvidence?.find((evidence) => evidence.criterionId === criterion.id),
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
