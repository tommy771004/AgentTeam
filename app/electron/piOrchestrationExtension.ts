export type PiLoopPattern = 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'

export type PiOrchestrationTurn = {
  result: string
  settlement: 'success' | 'failed' | 'cancelled' | 'interrupted'
}

export type PiOrchestrationInput = {
  pattern: PiLoopPattern
  prompt: string
  maxIterations?: number
  turn: (prompt: string, iteration: number) => Promise<PiOrchestrationTurn>
}

/**
 * The single orchestration extension for Pi Core. Loop selection is metadata;
 * each iteration remains a child Pi turn and never creates a private legacy
 * agent engine. The default cap keeps unattended automation bounded.
 */
export async function runPiOrchestration(input: PiOrchestrationInput): Promise<PiOrchestrationTurn & { iterations: number; pattern: PiLoopPattern }> {
  const limit = Math.max(1, Math.min(8, Math.floor(input.maxIterations || 1)))
  let last: PiOrchestrationTurn = { result: '', settlement: 'failed' }
  for (let iteration = 1; iteration <= limit; iteration += 1) {
    last = await input.turn(input.prompt, iteration)
    if (last.settlement !== 'success' || input.pattern === 'Turn-based' || input.pattern === 'Time-based' || input.pattern === 'Proactive') {
      return { ...last, iterations: iteration, pattern: input.pattern }
    }
  }
  return { ...last, iterations: limit, pattern: input.pattern }
}
