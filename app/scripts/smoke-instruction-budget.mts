import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInstructionSnapshot } from '../electron/instructionResolver.ts'
import { selectPiMemoryContextWithinBytes } from '../electron/piSessionContext.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import { buildContextPacket } from '../src/agent/hermes/contextPacket.ts'
import type { TurnRecord } from '../src/agent/turnRecord.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-budget-'))
try {
  const project = join(root, '專案')
  await mkdir(project)
  await writeFile(join(project, 'AGENTS.md'), 'PROJECT-HIGH-AUTHORITY\n保留這段規則')

  const snapshot = await resolveInstructionSnapshot({
    globalRevision: 21,
    globalCustomInstructions: `GLOBAL-LOWER-AUTHORITY\n${'全域'.repeat(80)}`,
    projectRoot: project,
    workPath: project,
    limits: {
      totalBytes: 320,
      personalizationBytes: 96,
      projectInstructionBytes: 224,
      perFileBytes: 512,
    },
  })
  assert.match(snapshot.effectiveText, /PROJECT-HIGH-AUTHORITY/, 'project authority is retained before global and memory')
  assert.doesNotMatch(snapshot.effectiveText, /GLOBAL-LOWER-AUTHORITY/, 'oversized global slot fails closed')
  assert.equal(snapshot.usage.personalizationBudgetBytes, 96)
  assert.equal(snapshot.usage.projectInstructionBudgetBytes, 224)
  assert.ok(snapshot.usage.totalBytes <= snapshot.usage.budgetBytes)
  assert.equal(snapshot.usage.lowerAuthorityAvailableBytes, snapshot.usage.budgetBytes - snapshot.usage.totalBytes)
  assert.ok(snapshot.diagnostics.some((item) => item.code === 'total-budget' && item.message.includes('global personalization')))

  const hiddenInclude = join(root, 'must-not-traverse.md')
  await writeFile(hiddenInclude, 'REJECTED-PARENT-INCLUDE-MUST-NOT-APPLY')
  const rejectedParent = await resolveInstructionSnapshot({
    globalRevision: 22,
    globalCustomInstructions: `@${hiddenInclude}\n${'超額'.repeat(100)}`,
    limits: { totalBytes: 256, personalizationBytes: 48, projectInstructionBytes: 128, perFileBytes: 512 },
  })
  assert.doesNotMatch(rejectedParent.effectiveText, /REJECTED-PARENT-INCLUDE-MUST-NOT-APPLY/, 'a rejected parent source cannot smuggle an include traversal')

  const memory = selectPiMemoryContextWithinBytes([{
    id: 'm1',
    text: '記憶🙂'.repeat(200),
    tags: ['learned'],
    createdAt: '2026-08-29T00:00:00.000Z',
  }], snapshot.usage.lowerAuthorityAvailableBytes)
  assert.ok(snapshot.usage.totalBytes + memory.includedBytes <= snapshot.usage.budgetBytes, 'instructions and learned memory share one total budget')
  assert.equal(Buffer.from(memory.context).toString('utf8'), memory.context, 'Unicode clipping never emits a partial code point')
  assert.equal(memory.includedBytes, Buffer.byteLength(memory.context))
  assert.ok(memory.droppedBytes > 0)

  const packet = buildContextPacket({
    projectGuidance: 'PROJECT-CONTEXT-SLOT '.repeat(40),
    globalPersonalization: 'GLOBAL-CONTEXT-SLOT '.repeat(40),
    memory: 'LOW-AUTHORITY-MEMORY '.repeat(80),
  }, { totalBudget: 1_800 })
  assert.ok(packet.includedBySlot.projectGuidance?.includes('PROJECT-CONTEXT-SLOT'))
  assert.ok(packet.includedBySlot.globalPersonalization?.includes('GLOBAL-CONTEXT-SLOT'))
  assert.equal(packet.includedBySlot.memory, undefined, 'learned memory drops before explicit instruction slots')
  assert.ok(packet.diagnostics.totalIncludedChars <= packet.diagnostics.totalBudget)

  const instructionEntry = {
    kind: 'instruction-snapshot' as const,
    source: 'host' as const,
    seq: 1,
    turn: 1,
    step: 1,
    at: 1,
    snapshot,
  }
  const record = { version: 1 as const, entries: [instructionEntry] } as TurnRecord
  const live = projectContextUsage(record)
  const replay = projectContextUsage(JSON.parse(JSON.stringify(record)) as TurnRecord)
  assert.deepEqual(live.instructions, replay.instructions, 'live and replay use the same recorded instruction slots')
  assert.equal(live.instructions?.personalizationBudgetBytes, 96)
  assert.equal(live.instructions?.projectInstructionBudgetBytes, 224)

  console.log('instruction ContextPacket budget smoke: ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
