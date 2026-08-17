/** Development/evaluation CLI for the coordinator-owned headless seam. */
import { createJiti } from 'jiti'

const objective = process.argv.slice(2).join(' ').trim() || 'headless task'
const jiti = createJiti(import.meta.url, { interopDefault: true })
const { runHeadlessTask } = await jiti.import('../src/agent/headlessRun.ts') as typeof import('../src/agent/headlessRun.ts')
const result = await runHeadlessTask({ objective })
process.stdout.write(`${JSON.stringify({
  runId: result.runId,
  threadId: result.threadId,
  status: result.status,
  result: result.result,
  error: result.error,
}, null, 2)}\n`)
