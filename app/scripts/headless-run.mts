/** Development/evaluation CLI for the coordinator-owned headless seam. */
import { runHeadlessTask } from '../src/agent/headlessRun.ts'

const objective = process.argv.slice(2).join(' ').trim() || 'headless task'
const result = await runHeadlessTask({ objective })
process.stdout.write(`${JSON.stringify({
  runId: result.runId,
  threadId: result.threadId,
  status: result.status,
  result: result.result,
  error: result.error,
}, null, 2)}\n`)
