import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeContinuationItems, selectContinuationItem } from '../src/agent/continuation.ts'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'
import { ensurePiPacksRegistered } from '../electron/piExtensionPacks/index.ts'
import { findPiPackTool } from '../electron/piToolHost.ts'
import { clearPiContinuationItems, getPiContinuationItems } from '../electron/piPackBridges.ts'
import { JsonCompactionCheckpointStore } from '../electron/compactionCheckpointStore.ts'

const item = {
  id: 'verify-build',
  title: '驗證建置',
  description: '完成型別檢查與 smoke',
  acceptanceCriteria: ['tsc 與 smoke 通過'],
  priority: 80,
  dependencies: [],
  scope: 'original-objective',
  requiresAdditionalAuthority: false,
  status: 'candidate',
}

const normalized = normalizeContinuationItems([item])
assert.equal(normalized.length, 1)
assert.equal(selectContinuationItem(normalized).item?.id, item.id)
assert.match(selectContinuationItem(normalizeContinuationItems([{ ...item, scope: 'expanded' }])).blockedReason || '', /超出原始 objective/)
assert.match(selectContinuationItem(normalizeContinuationItems([{ ...item, requiresAdditionalAuthority: true }])).blockedReason || '', /需要額外權限/)
assert.match(selectContinuationItem(normalizeContinuationItems([{ ...item, dependencies: ['missing'] }])).blockedReason || '', /dependencies/)

ensurePiPacksRegistered()
const recorder = findPiPackTool('record_continuation_items')?.tool
assert.ok(recorder)
await recorder!.execute({ items: [item] }, {
  sessionId: 'continuation-session',
  runId: 'continuation-run',
  callId: 'continuation-call',
  cwd: process.cwd(),
})
assert.equal(getPiContinuationItems('continuation-session', 'continuation-run')[0]?.id, item.id)

const prompts: string[] = []
const orchestration = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'original objective',
  maxIterations: 3,
  turn: async (prompt, iteration) => {
    prompts.push(prompt)
    return iteration === 1
      ? { settlement: 'answered', result: 'first pass', done: false, nextPrompt: 'continue without a user turn' }
      : { settlement: 'answered', result: 'verified', done: true }
  },
})
assert.deepEqual(prompts, ['original objective', 'continue without a user turn'])
assert.equal(orchestration.dodMet, true)

const checkpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentteam-continuation-'))
try {
  const store = new JsonCompactionCheckpointStore(checkpointRoot)
  const saved = store.save({
    runId: 'continuation-run',
    summary: 'checkpoint',
    messages: [],
    parkedAtToolBoundary: true,
    replaySafe: true,
    continuationItems: normalized,
  })
  assert.equal(saved.ok, true)
  assert.equal(store.load('continuation-run')?.continuationItems?.[0]?.id, item.id)
} finally {
  fs.rmSync(checkpointRoot, { recursive: true, force: true })
  clearPiContinuationItems('continuation-session', 'continuation-run')
}

console.log('Pi Host continuation smoke passed')
