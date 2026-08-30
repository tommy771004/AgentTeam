import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveBusyPolicy } from '../src/agent/taskRunTypes.ts'

assert.equal(resolveBusyPolicy('review', 'steer'), 'steer')
assert.equal(resolveBusyPolicy('review', 'queue'), 'queue')

const workflow = await readFile(new URL('../src/agent/reviewFeedbackRun.ts', import.meta.url), 'utf8')
assert.match(workflow, /prepareFeedback\(snapshotId\)[\s\S]*claimFeedback\(prepared\.id, runId\)[\s\S]*runTask\(\{/)
assert.equal((workflow.match(/runTask\(\{/g) || []).length, 1, 'review feedback has exactly one run ingress')
assert.match(workflow, /sourceKind: 'review'/)
assert.match(workflow, /reuseThreadId: claim\.bundle\.threadId/)
assert.match(workflow, /runner: thread\?\.runner \|\| 'builtin'/, 'external runner selection remains the conversation capability owner')
assert.match(workflow, /extraContext: JSON\.stringify\(\{ kind: 'review-feedback', bundle: claim\.bundle \}\)/, 'the claimed Host bundle is frozen into admission input')
assert.match(workflow, /run_\$\{prepared\.id\.slice\(-24\)\}/, 'stable bundle identity produces a stable run id')
assert.match(workflow, /inheritState\?\.\(snapshotId, afterSnapshotId\)[\s\S]*snapshot-range/, 'settlement links A to B and asks Host to project review state')
assert.doesNotMatch(workflow, /dispatchThreadTask|startExecution|dispatchThread|enqueueExternalRun/)

const explorer = await readFile(new URL('../src/components/ReviewExplorer.tsx', import.meta.url), 'utf8')
assert.match(explorer, /送交 Agent 修改/)
assert.match(explorer, /reduced capability disclosure/)
assert.doesNotMatch(explorer, /runTask|dispatchThreadTask|startExecution/)

const store = await readFile(new URL('../electron/reviewStateStore.ts', import.meta.url), 'utf8')
assert.match(store, /review_feedback_bundles/)
assert.match(store, /status === 'dispatched'[\s\S]*claimed: false/)
console.log('smoke-review-feedback-workflow passed')
