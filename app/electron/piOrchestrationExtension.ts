import { isCompletedModelCall, type PiTurnSettlement } from '../src/agent/piHostRun.ts'

export type PiLoopPattern = 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'

/** Why a turn stopped short of its own settlement. */
export type PiInterruptReason = 'user' | 'timeout'

export type PiOrchestrationTurn = {
  result: string
  settlement: PiTurnSettlement
  /** Present only on an `interrupted` settlement. */
  interruptReason?: PiInterruptReason
  /** Optional DoD verdict supplied by the Pi turn owner. */
  done?: boolean
  /** Host-authored prompt for the next internal iteration. */
  nextPrompt?: string
  /** Explicitly settle after this iteration without claiming DoD. */
  continue?: boolean
}

export type PiOrchestrationInput = {
  pattern: PiLoopPattern
  prompt: string
  maxIterations?: number
  turn: (prompt: string, iteration: number) => Promise<PiOrchestrationTurn>
  /** Returns the pending interrupt reason, checked between iterations. */
  interrupted?: () => PiInterruptReason | undefined
}

function iterationResult(last: PiOrchestrationTurn, iterations: number, pattern: PiLoopPattern) {
  return {
    ...last,
    iterations,
    pattern,
    ...(last.done === undefined ? {} : { dodMet: last.done }),
  }
}

function patternSettlesAfterOneTurn(pattern: PiLoopPattern): boolean {
  return pattern !== 'Goal-based'
}

/**
 * The single orchestration extension for Pi Core. Loop selection is metadata;
 * each iteration remains a child Pi turn and never creates a private legacy
 * agent engine. The default cap keeps unattended automation bounded.
 */
export async function runPiOrchestration(input: PiOrchestrationInput): Promise<PiOrchestrationTurn & { iterations: number; pattern: PiLoopPattern; dodMet?: boolean }> {
  const limit = Math.max(1, Math.min(8, Math.floor(input.maxIterations || 1)))
  let last: PiOrchestrationTurn = { result: '', settlement: 'failed' }
  let iterationPrompt = input.prompt
  for (let iteration = 1; iteration <= limit; iteration += 1) {
    last = await input.turn(iterationPrompt, iteration)
    // A completed model call may continue the goal: `answered` produced text
    // and `empty` produced none, and an empty round is exactly the case another
    // iteration exists to fix. Only a stop or a failure ends the loop here.
    if (!isCompletedModelCall(last.settlement) || patternSettlesAfterOneTurn(input.pattern)) {
      return iterationResult(last, iteration, input.pattern)
    }
    if (last.continue === false) {
      return iterationResult(last, iteration, input.pattern)
    }
    if (last.done === true) return { ...last, iterations: iteration, pattern: input.pattern, dodMet: true }
    // A stop between iterations is still a stop: never start another one.
    if (input.interrupted?.()) {
      return {
        ...last,
        settlement: 'interrupted',
        interruptReason: input.interrupted(),
        iterations: iteration,
        pattern: input.pattern,
        ...(last.done === undefined ? {} : { dodMet: last.done }),
      }
    }
    if (last.nextPrompt?.trim()) iterationPrompt = last.nextPrompt.trim()
  }
  return {
    ...last,
    // An unmet DoD at the cap is a failed goal; an interrupt is not.
    settlement: last.settlement === 'interrupted' ? 'interrupted' : last.done === false ? 'failed' : last.settlement,
    result: last.done === false && !last.result ? 'Pi Goal-based DoD was not met before the iteration cap.' : last.result,
    iterations: limit,
    pattern: input.pattern,
    ...(last.done === undefined ? {} : { dodMet: last.done }),
  }
}
