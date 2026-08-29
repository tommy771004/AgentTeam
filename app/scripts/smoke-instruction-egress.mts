import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveInstructionSnapshot } from '../electron/instructionResolver.ts'
import { sanitizeInstructionSnapshotForProvider } from '../electron/piHostProtocol.ts'
import { connectionIdForBuiltinLlm } from '../src/agent/outbound/providerConnectionId.ts'
import { mapSanitizedInstructionSnapshot } from '../src/agent/instructionSnapshot.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-egress-'))
const priorPolicyDir = process.env.SUBAGENTS_OUTBOUND_POLICY_DIR
try {
  process.env.SUBAGENTS_OUTBOUND_POLICY_DIR = root
  const raw = await resolveInstructionSnapshot({
    globalRevision: 1,
    globalCustomInstructions: 'api_key=GLOBAL_SECRET\n' + 'keep context '.repeat(8),
    aboutUser: 'user@example.com',
  })
  const connectionId = connectionIdForBuiltinLlm({ apiProvider: 'smoke', baseUrl: '' })
  const sanitized = await sanitizeInstructionSnapshotForProvider({
    snapshot: raw,
    mode: 'optional',
    connectionId,
    provider: 'smoke',
    runId: 'egress-optional',
  })
  assert.ok(!sanitized.effectiveText.includes('GLOBAL_SECRET'))
  assert.ok(!sanitized.effectiveText.includes('user@example.com'))
  assert.ok(sanitized.effectiveText.includes('PROTECTED_EXCLUSION'))
  assert.ok(sanitized.sources.every((source) => !source.content.includes('GLOBAL_SECRET')))
  assert.ok(!sanitized.globalEffectiveText.includes('GLOBAL_SECRET'))
  assert.equal(sanitized.usage.totalBytes, sanitized.sources.reduce((total, source) => total + (source.applied ? source.includedBytes : 0), 0))
  assert.equal(sanitized.usage.personalizationBytes + sanitized.usage.projectInstructionBytes, sanitized.usage.totalBytes)

  // Source attribution is based on the delivered bodies, not the admitted
  // snapshot's old ratio. Keep deliberately asymmetric mixed scopes so a
  // proportional allocator cannot pass this regression (47/150 bytes).
  const exactBytes = (prefix: string, total: number, fill: string) => `${prefix}${fill.repeat(total - Buffer.byteLength(prefix))}`
  const mixedGlobal = exactBytes('⟦PROTECTED_EXCLUSION⟧', 47, 'g')
  const mixedProject = exactBytes('⟦PROTECTED_EXCLUSION⟧', 150, 'p')
  const mixed = await mapSanitizedInstructionSnapshot({
    id: 'ins_mixed', revision: 1, effectiveHash: '0'.repeat(64), effectiveText: 'old', globalEffectiveText: 'old',
    sources: [
      { id: 'global', kind: 'global-custom', scope: 'global', revision: 1, bytes: 10, includedBytes: 10, droppedBytes: 0, hash: '1'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'old-global' },
      { id: 'project', kind: 'project-root', scope: 'project', revision: 1, bytes: 10, includedBytes: 10, droppedBytes: 0, hash: '2'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'old-project' },
    ],
    diagnostics: [],
    usage: { personalizationBytes: 10, projectInstructionBytes: 10, totalBytes: 20, budgetBytes: 512 },
    deliveryMode: 'explicit', exactSnapshot: true,
  }, {
    effectiveText: mixedGlobal + mixedProject,
    globalEffectiveText: mixedGlobal,
    sourceContents: [mixedGlobal, mixedProject],
  }, (text) => text)
  assert.equal(mixed.usage.personalizationBytes, 47)
  assert.equal(mixed.usage.projectInstructionBytes, 150)
  assert.equal(mixed.usage.totalBytes, 197)
  assert.equal(mixed.usage.personalizationBytes + mixed.usage.projectInstructionBytes, mixed.usage.totalBytes)

  // Redaction markers are deliberately longer than some classified spans.
  // A tiny admitted budget must fail closed rather than let the marker expand
  // the provider text beyond the resolver's advertised cap.
  const tiny = await resolveInstructionSnapshot({
    globalRevision: 2,
    globalCustomInstructions: 'api_key=G',
    limits: { totalBytes: 33, perFileBytes: 64 },
  })
  assert.ok(tiny.usage.totalBytes <= tiny.usage.budgetBytes)
  await assert.rejects(
    sanitizeInstructionSnapshotForProvider({
      snapshot: tiny,
      mode: 'optional',
      connectionId,
      provider: 'smoke',
      runId: 'egress-optional-tiny-budget',
    }),
    (error: unknown) => error instanceof Error && error.message.includes('exceeds its admitted'),
  )

  await mkdir(join(root, 'providers'), { recursive: true })
  await writeFile(join(root, 'company-base.json'), '{malformed')
  await assert.rejects(
    sanitizeInstructionSnapshotForProvider({
      snapshot: raw,
      mode: 'required',
      connectionId: connectionIdForBuiltinLlm({ apiProvider: 'broken', baseUrl: '' }),
      provider: 'broken',
      runId: 'egress-required-broken',
    }),
    (error: unknown) => error instanceof Error && error.message.includes('出站資料閘門拒絕'),
  )
} finally {
  if (priorPolicyDir === undefined) delete process.env.SUBAGENTS_OUTBOUND_POLICY_DIR
  else process.env.SUBAGENTS_OUTBOUND_POLICY_DIR = priorPolicyDir
  await rm(root, { recursive: true, force: true })
}

console.log('instruction egress smoke: ok')
