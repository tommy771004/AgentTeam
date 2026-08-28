import assert from 'node:assert/strict'
import {
  externalCliContinuationPrompt,
  parseExternalCliContinuationEnvelope,
  runExternalCliOrchestration,
} from '../src/agent/externalCliOrchestration.ts'
import { EXTERNAL_ORCHESTRATED_RUNNER_CAPABILITIES } from '../src/agent/runners/types.ts'

const item = {
  id: 'test-next',
  title: '補齊測試',
  description: '執行剩餘 smoke',
  acceptanceCriteria: ['smoke 通過'],
  priority: 90,
  dependencies: [],
  scope: 'original-objective',
  requiresAdditionalAuthority: false,
  status: 'candidate',
}
const envelope = (done: boolean, items: unknown[]) =>
  `<agentteam-continuation>${JSON.stringify({ done, items })}</agentteam-continuation>`

assert.equal(parseExternalCliContinuationEnvelope(envelope(false, [item]))?.items[0]?.id, item.id)
assert.match(externalCliContinuationPrompt({ objective: 'ship' }), /Do not ask the user to send another message/)
assert.equal(EXTERNAL_ORCHESTRATED_RUNNER_CAPABILITIES.iterate, true)
assert.equal(EXTERNAL_ORCHESTRATED_RUNNER_CAPABILITIES.validateDoD, false)

const prompts: string[] = []
const completed = await runExternalCliOrchestration({
  objective: 'ship',
  maxIterations: 4,
  initialAgentMode: 'plan',
  execute: async (prompt, iteration, phase) => {
    prompts.push(`${phase}:${prompt}`)
    return {
      ok: true,
      output: iteration === 1
        ? `first\n${envelope(false, [item])}`
        : `verified\n${envelope(true, [])}`,
    }
  },
})
assert.equal(completed.iterations, 2)
assert.equal(completed.output, 'verified')
assert.match(prompts[1] || '', /補齊測試/)
assert.match(prompts[0] || '', /^plan:/)
assert.match(prompts[1] || '', /^build:/)

const blocked = await runExternalCliOrchestration({
  objective: 'do not expand',
  maxIterations: 4,
  execute: async () => ({ ok: true, output: envelope(false, [{ ...item, scope: 'expanded' }]) }),
})
assert.equal(blocked.iterations, 1)
assert.match(blocked.orchestrationStopReason || '', /超出原始 objective/)

const legacy = await runExternalCliOrchestration({
  objective: 'legacy provider',
  maxIterations: 4,
  execute: async () => ({ ok: true, output: 'ordinary one-shot answer' }),
})
assert.equal(legacy.ok, true)
assert.equal(legacy.iterations, 1)
assert.match(legacy.orchestrationStopReason || '', /未回傳有效續行 envelope/)

console.log('External CLI orchestration smoke passed')
