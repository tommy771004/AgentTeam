import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import { parseTurnRecord } from '../src/agent/turnRecord.ts'
import { instructionDeliveryEvidence } from '../src/agent/instructionSnapshot.ts'

const snapshot = {
  id: 'ins_external_ui', revision: 12, effectiveHash: 'a'.repeat(64),
  effectiveText: 'GLOBAL_UI_RULE\nPROJECT_UI_RULE', globalEffectiveText: 'GLOBAL_UI_RULE',
  sources: [
    { id: 'global', kind: 'global-custom', scope: 'global' as const, path: '/tmp/global', revision: 12, bytes: 14, includedBytes: 14, droppedBytes: 0, hash: 'b'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'GLOBAL_UI_RULE' },
    { id: 'project-shadow', kind: 'agents', scope: 'project' as const, path: '/tmp/project/AGENTS.md', revision: 12, bytes: 18, includedBytes: 0, droppedBytes: 18, hash: 'c'.repeat(64), applied: false, deduplicated: false, truncated: false, shadowed: true, content: '' },
  ],
  diagnostics: [{ code: 'shadowed', message: 'project source shadowed' }],
  usage: { personalizationBytes: 14, projectInstructionBytes: 0, totalBytes: 14, budgetBytes: 1024 },
  deliveryMode: 'native' as const, exactSnapshot: false,
}
const record = buildExternalCliRecord({
  runner: 'codex', prompt: 'read-only request', events: [], answer: 'done', settlement: 'answered', instructionSnapshot: snapshot,
})
const live = projectContextUsage(record)
const replay = projectContextUsage(parseTurnRecord(JSON.parse(JSON.stringify(record))).record)
assert.deepEqual(replay.instructions, live.instructions, 'replay retains the same delivery evidence')
assert.equal(live.instructions?.deliveryMode, 'native')
assert.equal(live.instructions?.hashAvailable, true)
assert.equal(live.instructions?.sourceSummary[1]?.status, 'shadowed')
assert.match(live.instructions?.limitationReason || '', /provider-owned native discovery/)

// The shipped component consumes this shared evidence object. Node's strip
// types loader intentionally does not execute TSX, so keep this bounded smoke
// at the production presentation contract and let Electron/Playwright own DOM
// qualification.
const evidence = instructionDeliveryEvidence(snapshot)
assert.equal(evidence.sourceSummary[1]?.status, 'shadowed')
const panelSource = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/ContextUsagePanel.tsx'), 'utf8')
for (const text of ['instructions.hashAvailable', 'instructions.limitationReason', 'instructions.sourceSummary', '來源摘要']) {
  assert.ok(panelSource.includes(text), `ContextUsagePanel renders ${text}`)
}
console.log('external CLI record/UI smoke passed: live/replay delivery evidence and production panel contract')
