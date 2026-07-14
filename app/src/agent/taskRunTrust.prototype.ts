/**
 * PROTOTYPE — throwaway state model for execution-trust decisions.
 *
 * Question: Does the model still feel safe when, like Codex, a parent task
 * owns isolated child work and may only claim success after it integrates it?
 * This reducer has no I/O and may be lifted into production only after the
 * terminal prototype has settled the product decision.
 */

export type PrototypeRunStatus =
  | 'running'
  | 'awaiting-question'
  | 'degraded'
  | 'simulated'
  | 'cancelled'
  | 'success'

export type PrototypeEvidence = 'verified' | 'degraded' | 'simulation' | null

export type PrototypeRun = {
  id: string
  source: string
  status: PrototypeRunStatus
  evidence: PrototypeEvidence
  reason?: string
  finalized: boolean
}

export type PrototypeQuestion = {
  id: string
  runId: string
  prompt: string
}

export type PrototypeChild = {
  id: string
  parentRunId: string
  status: 'running' | 'completed' | 'cancelled'
  integrated: boolean
}

export type TaskRunTrustState = {
  runs: Record<string, PrototypeRun>
  children: Record<string, PrototypeChild>
  questions: PrototypeQuestion[]
  nextQuestionId: number
  nextChildId: number
  events: string[]
}

export type TaskRunTrustAction =
  | { type: 'admit'; runId: string; source: string }
  | { type: 'ask'; runId: string; prompt: string }
  | { type: 'resolve-current' }
  | { type: 'timeout-current' }
  | { type: 'spawn-child'; runId: string }
  | { type: 'complete-child'; childId: string }
  | { type: 'integrate-child'; runId: string; childId: string }
  | { type: 'degrade'; runId: string; reason: string }
  | { type: 'simulate'; runId: string }
  | { type: 'cancel'; runId: string }
  | { type: 'finalize-verified'; runId: string }
  | { type: 'reset' }

export const initialTaskRunTrustState = (): TaskRunTrustState => ({
  runs: {},
  children: {},
  questions: [],
  nextQuestionId: 1,
  nextChildId: 1,
  events: ['Prototype ready. Admit one or two Loop runs to begin.'],
})

function withEvent(state: TaskRunTrustState, event: string): TaskRunTrustState {
  return { ...state, events: [...state.events.slice(-7), event] }
}

function setRun(
  state: TaskRunTrustState,
  runId: string,
  patch: Partial<PrototypeRun>,
): TaskRunTrustState {
  const run = state.runs[runId]
  if (!run) return withEvent(state, `Ignored: ${runId} does not exist.`)
  return { ...state, runs: { ...state.runs, [runId]: { ...run, ...patch } } }
}

function hasQueuedQuestion(state: TaskRunTrustState, runId: string): boolean {
  return state.questions.some((question) => question.runId === runId)
}

function childrenFor(state: TaskRunTrustState, runId: string): PrototypeChild[] {
  return Object.values(state.children).filter((child) => child.parentRunId === runId)
}

function cancelChildren(state: TaskRunTrustState, runId: string): TaskRunTrustState {
  const children = { ...state.children }
  for (const child of childrenFor(state, runId)) {
    if (child.status === 'running') children[child.id] = { ...child, status: 'cancelled' }
  }
  return { ...state, children }
}

function settleCurrentQuestion(state: TaskRunTrustState, outcome: 'answered' | 'timed out') {
  const current = state.questions[0]
  if (!current) return withEvent(state, 'Ignored: no FIFO question is waiting.')
  let next: TaskRunTrustState = {
    ...state,
    questions: state.questions.slice(1),
  }
  if (!hasQueuedQuestion(next, current.runId)) {
    next = setRun(next, current.runId, { status: 'running' })
  }
  return withEvent(next, `Question ${current.id} for ${current.runId} ${outcome}.`)
}

export function reduceTaskRunTrust(
  state: TaskRunTrustState,
  action: TaskRunTrustAction,
): TaskRunTrustState {
  if (action.type === 'reset') return initialTaskRunTrustState()

  if (action.type === 'admit') {
    const existing = state.runs[action.runId]
    if (existing) {
      return withEvent(
        state,
        `Duplicate rejected: ${action.runId} already has owner status=${existing.status}.`,
      )
    }
    return withEvent(
      {
        ...state,
        runs: {
          ...state.runs,
          [action.runId]: {
            id: action.runId,
            source: action.source,
            status: 'running',
            evidence: null,
            finalized: false,
          },
        },
      },
      `Admitted ${action.runId} from ${action.source}.`,
    )
  }

  const runId = 'runId' in action ? action.runId : undefined
  const run = runId ? state.runs[runId] : undefined
  if (runId && !run) return withEvent(state, `Ignored: ${runId} does not exist.`)

  if (action.type === 'ask') {
    if (run!.status !== 'running') {
      return withEvent(state, `Ignored: ${runId} cannot ask while ${run!.status}.`)
    }
    const question: PrototypeQuestion = {
      id: `q${state.nextQuestionId}`,
      runId: runId!,
      prompt: action.prompt,
    }
    return withEvent(
      {
        ...setRun(state, runId!, { status: 'awaiting-question' }),
        questions: [...state.questions, question],
        nextQuestionId: state.nextQuestionId + 1,
      },
      `Queued ${question.id} for ${runId}; FIFO size=${state.questions.length + 1}.`,
    )
  }

  if (action.type === 'resolve-current') return settleCurrentQuestion(state, 'answered')
  if (action.type === 'timeout-current') return settleCurrentQuestion(state, 'timed out')

  if (action.type === 'spawn-child') {
    if (run!.status !== 'running') {
      return withEvent(state, `Ignored: ${runId} cannot delegate while ${run!.status}.`)
    }
    const childId = `${runId}-child-${state.nextChildId}`
    return withEvent(
      {
        ...state,
        children: {
          ...state.children,
          [childId]: { id: childId, parentRunId: runId!, status: 'running', integrated: false },
        },
        nextChildId: state.nextChildId + 1,
      },
      `Spawned isolated child ${childId} for ${runId}.`,
    )
  }

  if (action.type === 'complete-child') {
    const child = state.children[action.childId]
    if (!child) return withEvent(state, `Ignored: ${action.childId} does not exist.`)
    if (child.status !== 'running') return withEvent(state, `Ignored: ${action.childId} is already ${child.status}.`)
    return withEvent(
      { ...state, children: { ...state.children, [child.id]: { ...child, status: 'completed' } } },
      `Child ${child.id} completed; parent must still integrate it.`,
    )
  }

  if (action.type === 'integrate-child') {
    const child = state.children[action.childId]
    if (!child || child.parentRunId !== runId) {
      return withEvent(state, `Ignored: ${action.childId} is not a child of ${runId}.`)
    }
    if (child.status !== 'completed') {
      return withEvent(state, `Blocked: ${action.childId} must complete before integration.`)
    }
    return withEvent(
      { ...state, children: { ...state.children, [child.id]: { ...child, integrated: true } } },
      `Parent ${runId} integrated ${child.id}.`,
    )
  }

  if (action.type === 'degrade') {
    const withoutRunQuestions = state.questions.filter((question) => question.runId !== runId)
    const next = cancelChildren(state, runId!)
    return withEvent(
      {
        ...setRun(next, runId!, {
          status: 'degraded',
          evidence: 'degraded',
          reason: action.reason,
          finalized: true,
        }),
        questions: withoutRunQuestions,
      },
      `${runId} degraded: ${action.reason}. Success is now blocked.`,
    )
  }

  if (action.type === 'simulate') {
    const next = cancelChildren(state, runId!)
    return withEvent(
      {
        ...setRun(next, runId!, {
          status: 'simulated',
          evidence: 'simulation',
          reason: 'Explicit offline simulation',
          finalized: true,
        }),
        questions: next.questions.filter((question) => question.runId !== runId),
      },
      `${runId} recorded as explicit simulation, not verified success.`,
    )
  }

  if (action.type === 'finalize-verified') {
    const childrenReady = childrenFor(state, runId!).every(
      (child) => child.status === 'completed' && child.integrated,
    )
    if (run!.status !== 'running' || hasQueuedQuestion(state, runId!) || !childrenReady) {
      return withEvent(
        state,
        `Blocked: ${runId} needs running status, no queued question, and integrated completed children.`,
      )
    }
    return withEvent(
      setRun(state, runId!, {
        status: 'success',
        evidence: 'verified',
        finalized: true,
      }),
      `${runId} finalized with verified evidence.`,
    )
  }

  if (action.type === 'cancel') {
    const withoutRunQuestions = state.questions.filter((question) => question.runId !== runId)
    const next = cancelChildren(state, runId!)
    return withEvent(
      {
        ...setRun(next, runId!, {
          status: 'cancelled',
          reason: 'User cancelled this run and its active children',
          finalized: true,
        }),
        questions: withoutRunQuestions,
      },
      `Cancelled ${runId}; unrelated runs and questions remain untouched.`,
    )
  }

  return state
}
