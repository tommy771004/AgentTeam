/**
 * PROTOTYPE — interactive shell for taskRunTrust.prototype.ts.
 * Run: npm run prototype:task-run-trust
 * No persistence, no production wiring, no tests by design.
 */
import readline from 'node:readline'
import {
  initialTaskRunTrustState,
  reduceTaskRunTrust,
  type TaskRunTrustAction,
  type TaskRunTrustState,
} from '../src/agent/taskRunTrust.prototype.ts'

const bold = (value: string) => `\x1b[1m${value}\x1b[0m`
const dim = (value: string) => `\x1b[2m${value}\x1b[0m`
let state: TaskRunTrustState = initialTaskRunTrustState()

function render() {
  console.clear()
  console.log(bold('PROTOTYPE — Task run trust state model'))
  console.log('Question: does parent/child coordination match a Codex-style isolated-agent workflow?')
  console.log(dim('In-memory only. This TUI is throwaway; the reducer is intentionally pure.'))
  console.log('')
  console.log(bold('Runs'))
  const runs = Object.values(state.runs)
  if (!runs.length) console.log('  (none)')
  for (const run of runs) {
    console.log(
      `  ${run.id}: status=${run.status} evidence=${run.evidence ?? 'none'} finalized=${run.finalized}` +
        (run.reason ? ` reason=${run.reason}` : ''),
    )
  }
  console.log('')
  console.log(bold('FIFO questions'))
  if (!state.questions.length) console.log('  (empty)')
  for (const [index, question] of state.questions.entries()) {
    console.log(`  ${index === 0 ? 'CURRENT' : 'queued '} ${question.id} → ${question.runId}: ${question.prompt}`)
  }
  console.log('')
  console.log(bold('Isolated child work'))
  const children = Object.values(state.children)
  if (!children.length) console.log('  (none)')
  for (const child of children) {
    console.log(`  ${child.id}: parent=${child.parentRunId} status=${child.status} integrated=${child.integrated}`)
  }
  console.log('')
  console.log(bold('Recent events'))
  for (const event of state.events) console.log(`  ${dim('•')} ${event}`)
  console.log('')
  console.log(bold('Commands'))
  console.log('  [1] admit run-A   [2] admit run-B   [d] duplicate run-A')
  console.log('  [q] ask run-A     [w] ask run-B     [a] answer current   [t] timeout current')
  console.log('  [c] spawn child A [g] complete child [i] integrate child [f] finalize A')
  console.log('  [l] LLM fail A    [s] simulate B    [k] cancel A          [r] reset   [x] quit')
  process.stdout.write('\n> ')
}

function dispatch(action: TaskRunTrustAction) {
  state = reduceTaskRunTrust(state, action)
}

function actionFor(input: string): TaskRunTrustAction | null {
  switch (input.trim().toLowerCase()) {
    case '1': return { type: 'admit', runId: 'run-A', source: 'composer' }
    case '2': return { type: 'admit', runId: 'run-B', source: 'schedule' }
    case 'd': return { type: 'admit', runId: 'run-A', source: 'retry' }
    case 'q': return { type: 'ask', runId: 'run-A', prompt: 'Approve the next write?' }
    case 'w': return { type: 'ask', runId: 'run-B', prompt: 'Choose an automation outcome?' }
    case 'a': return { type: 'resolve-current' }
    case 't': return { type: 'timeout-current' }
    case 'c': return { type: 'spawn-child', runId: 'run-A' }
    case 'g': return { type: 'complete-child', childId: 'run-A-child-1' }
    case 'i': return { type: 'integrate-child', runId: 'run-A', childId: 'run-A-child-1' }
    case 'l': return { type: 'degrade', runId: 'run-A', reason: 'LLM transport failed' }
    case 's': return { type: 'simulate', runId: 'run-B' }
    case 'f': return { type: 'finalize-verified', runId: 'run-A' }
    case 'k': return { type: 'cancel', runId: 'run-A' }
    case 'r': return { type: 'reset' }
    default: return null
  }
}

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
terminal.on('line', (input) => {
  if (input.trim().toLowerCase() === 'x') {
    terminal.close()
    return
  }
  const action = actionFor(input)
  if (action) dispatch(action)
  else state = { ...state, events: [...state.events.slice(-7), `Unknown command: ${input.trim() || '(empty)'}`] }
  render()
})
terminal.on('close', () => {
  console.log('\nPrototype closed. Capture the verdict before lifting any reducer decision into production.\n')
})

render()
