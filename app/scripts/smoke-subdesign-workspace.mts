import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createSubDesignProjectWorkspace,
  type SubDesignWorkspaceFileStore,
} from '../src/agent/subdesign/projectWorkspace.ts'

function createTempFileStore(root: string): SubDesignWorkspaceFileStore {
  const absolute = (relativePath: string) => {
    const normalized = relativePath.replaceAll('\\', '/')
    const target = path.resolve(root, normalized)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('path escaped test root')
    return target
  }

  return {
    root,
    exists: async (relativePath) => fs.existsSync(absolute(relativePath)),
    readFile: async (relativePath) => fs.readFileSync(absolute(relativePath)),
    writeFile: async (relativePath, data) => {
      const target = absolute(relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, data)
    },
    writeFilesAtomically: async (files) => {
      for (const file of files) {
        const target = absolute(file.path)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, file.data)
      }
    },
    writeExternal: async (filePath, data) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, data)
    },
    list: async (relativePath) => {
      const target = absolute(relativePath)
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return []
      return fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        dir: entry.isDirectory(),
      }))
    },
    stat: async (relativePath) => {
      const stat = fs.statSync(absolute(relativePath))
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size, mtimeMs: stat.mtimeMs }
    },
    mkdir: async (relativePath) => fs.mkdirSync(absolute(relativePath), { recursive: true }),
    isPathInside: async () => true,
  }
}

const fixedCrypto = {
  sha256: async (data: Uint8Array | string) => crypto.createHash('sha256').update(data).digest('hex'),
  hmacSha256: async (secret: Uint8Array, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex'),
  getSecret: async () => new Uint8Array(Buffer.from('subdesign-test-secret')),
  randomId: (prefix: string) => `${prefix}_test_000000000000`,
}
const exportProcesses: Record<string, unknown> = {}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subdesign-workspace-'))
const files = createTempFileStore(root)
const workspace = createSubDesignProjectWorkspace({
  files,
  clock: () => '2026-07-15T00:00:00.000Z',
  crypto: fixedCrypto,
  exportProcesses,
})
assert.equal('writeMetadata' in workspace, false)
const nonAtomicFiles = { ...files, writeFilesAtomically: undefined } as unknown as SubDesignWorkspaceFileStore
assert.throws(() => createSubDesignProjectWorkspace({ files: nonAtomicFiles }), /atomic/i)

const brief = {
  id: 'brief_test_01',
  threadId: 'thread_test_01',
  surface: 'prototype',
  objective: '建立產品頁',
  constraints: [],
  acceptanceCriteria: [],
  directions: [],
  stage: 'brief',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

const written = await workspace.createBrief({ brief, runId: 'run_test_01', threadId: brief.threadId })
assert.equal(written.ok, true)
const updatedBrief = await workspace.updateBrief({
  briefId: brief.id,
  patch: { objective: '建立更新後的產品頁' },
  runId: 'run_test_01',
  threadId: brief.threadId,
})
assert.equal(updatedBrief.ok, true)
if (updatedBrief.ok) assert.equal(updatedBrief.brief.objective, '建立更新後的產品頁')
const artifact = {
  id: 'artifact_test_01',
  briefId: brief.id,
  kind: 'html',
  title: 'index.html',
  entry: 'artifacts/index.html',
  renderer: 'html',
  exports: ['html', 'pdf'],
  supportingFiles: [],
  status: 'complete',
  revision: 1,
  createdAt: brief.createdAt,
  updatedAt: brief.updatedAt,
}
assert.equal((await workspace.registerArtifact({ artifact, briefId: brief.id, runId: 'run_test_01', threadId: brief.threadId })).ok, true)

await files.writeFile('.subagents/subdesign/critiques/bad.json', '{not-json')
await files.writeFile('.subagents/subdesign/critiques/malformed.json', JSON.stringify({ artifactId: '../escape', verdict: 'pass' }))
await files.writeFile('.subagents/subdesign/briefs/unsafe.json', JSON.stringify({ id: '../escape' }))

const snapshot = await workspace.readMetadata()
assert.deepEqual(snapshot.briefs.map((item) => (item as { id: string }).id), [brief.id])
assert.deepEqual(snapshot.artifacts.map((item) => (item as { id: string }).id), [artifact.id])
assert.equal(snapshot.critiques.length, 0)

const unsafe = await workspace.createBrief({ brief: { ...brief, id: '../escape' }, runId: 'run_test_01', threadId: brief.threadId })
assert.equal(unsafe.ok, false)
if (!unsafe.ok) assert.match(unsafe.error, /不安全|unsafe|id/i)

const entryPath = artifact.entry
await files.writeFile(entryPath, '<html><body><h1>Before</h1><p>Keep</p></body></html>')
const blockedPatch = await workspace.patchArtifact({
  artifact,
  operations: [{ path: entryPath, find: 'Before', replace: 'Blocked' }],
})
assert.equal(blockedPatch.ok, false)
assert.match((blockedPatch as { error: string }).error, /direction gate/i)
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>Before</h1><p>Keep</p></body></html>')

const selectedDirection = await workspace.selectDirection({
  briefId: brief.id,
  directionId: 'direction_01',
  fallback: { title: 'Calm', summary: '安靜' },
  runId: 'run_test_01',
  threadId: brief.threadId,
})
assert.equal(selectedDirection.ok, true)

const directionBrief = await workspace.setBriefStage({ briefId: brief.id, stage: 'build', runId: 'run_test_01', threadId: brief.threadId })
assert.equal(directionBrief.ok, true)

const atomicFailure = await workspace.patchArtifact({
  artifact,
  operations: [
    { path: entryPath, find: 'Before', replace: 'After' },
    { path: entryPath, find: 'Missing', replace: 'Never written' },
  ],
})
assert.equal(atomicFailure.ok, false)
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>Before</h1><p>Keep</p></body></html>')

const patched = await workspace.patchArtifact({
  artifact,
  operations: [{ path: entryPath, find: 'Before', replace: 'After' }],
})
assert.equal(patched.ok, true)
if (patched.ok) {
  assert.equal(patched.artifact.revision, 2)
  assert.deepEqual(patched.paths, [entryPath])
}
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>After</h1><p>Keep</p></body></html>')

const wrongThreadScope = await workspace.patchArtifact({
  artifact: patched.ok ? patched.artifact : artifact,
  runId: 'run_other_01',
  threadId: 'thread_other_01',
  operations: [{ path: entryPath, find: 'After', replace: 'Wrong scope' }],
})
assert.equal(wrongThreadScope.ok, false)
if (!wrongThreadScope.ok) assert.equal(wrongThreadScope.code, 'RUN_SCOPE_MISMATCH')
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>After</h1><p>Keep</p></body></html>')

const stalePatch = await workspace.patchArtifact({
  artifact,
  operations: [{ path: entryPath, find: 'After', replace: 'Stale writer' }],
})
assert.equal(stalePatch.ok, false)
if (!stalePatch.ok) assert.equal(stalePatch.code, 'ARTIFACT_REVISION_CONFLICT')
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>After</h1><p>Keep</p></body></html>')

const afterPatch = await workspace.readMetadata()
assert.equal((afterPatch.artifacts[0] as { revision: number }).revision, 2)

const tweakArtifactSeed = {
  ...(patched.ok ? patched.artifact : artifact),
  tweaks: [{
    id: 'font_size',
    label: '字級',
    kind: 'number',
    path: entryPath,
    find: 'Keep',
    replaceTemplate: 'Size={{value}}',
    value: '4',
    min: 1,
    max: 10,
  }],
}
const tweakRegistration = await workspace.registerArtifact({ artifact: tweakArtifactSeed, briefId: brief.id, runId: 'run_test_01', threadId: brief.threadId })
assert.equal(tweakRegistration.ok, true)
const tweakArtifact = tweakRegistration.ok ? tweakRegistration.artifact : tweakArtifactSeed

const rejectedTweak = await workspace.applyTweak({ artifact: tweakArtifact, tweakId: 'font_size', value: '99' })
assert.equal(rejectedTweak.ok, false)
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>After</h1><p>Keep</p></body></html>')

const appliedTweak = await workspace.applyTweak({ artifact: tweakArtifact, tweakId: 'font_size', value: ' 7 ' })
assert.equal(appliedTweak.ok, true)
if (appliedTweak.ok) {
  assert.equal(appliedTweak.artifact.revision, tweakArtifact.revision + 1)
  assert.equal(appliedTweak.artifact.tweaks?.[0]?.value, '7')
}
assert.equal(new TextDecoder().decode(await files.readFile(entryPath)), '<html><body><h1>After</h1><p>Size=7</p></body></html>')

const readEntry = await workspace.readArtifact({ entry: entryPath })
assert.equal(readEntry.ok, true)
if (readEntry.ok) assert.match(readEntry.content, /Size=7/)

const evidenceArtifact = appliedTweak.ok ? appliedTweak.artifact : tweakArtifact
const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
])
const screenshot = await workspace.captureEvidence({
  artifact: evidenceArtifact,
  kind: 'screenshot',
  capture: async () => png,
})
const dom = await workspace.captureEvidence({
  artifact: evidenceArtifact,
  kind: 'dom',
  capture: async () => '<!doctype html><html><body>snapshot</body></html>',
})
const lint = await workspace.lintArtifact({ artifact: evidenceArtifact })
assert.equal(screenshot.ok, true)
assert.equal(dom.ok, true)
assert.equal(lint.ok, true)
if (screenshot.ok && dom.ok && lint.ok) {
  const evidence = [
    { kind: 'screenshot', summary: 'screenshot', ...screenshot },
    { kind: 'dom', summary: 'DOM', ...dom },
    { kind: 'lint', summary: 'lint', ...lint.evidence },
  ]
  const verified = await workspace.verifyEvidence({ artifact: evidenceArtifact, evidence })
  assert.equal(verified.ok, true)

  const stale = await workspace.verifyEvidence({ artifact: { ...evidenceArtifact, revision: evidenceArtifact.revision + 1 }, evidence })
  assert.equal(stale.ok, false)

  await files.writeFile(screenshot.path, new Uint8Array([1, 2, 3]))
  const modified = await workspace.verifyEvidence({ artifact: evidenceArtifact, evidence })
  assert.equal(modified.ok, false)

  const restoredScreenshot = await workspace.captureEvidence({
    artifact: evidenceArtifact,
    kind: 'screenshot',
    capture: async () => png,
  })
  assert.equal(restoredScreenshot.ok, true)
  if (restoredScreenshot.ok) {
    const validEvidence = [
      { kind: 'screenshot', summary: 'screenshot', ...restoredScreenshot },
      { kind: 'dom', summary: 'DOM', ...dom },
      { kind: 'lint', summary: 'lint', ...lint.evidence },
    ]
    const passingCritique = {
      artifactId: evidenceArtifact.id,
      briefId: evidenceArtifact.briefId,
      revision: evidenceArtifact.revision,
      briefCoverage: 90,
      brandConformance: 90,
      accessibility: 90,
      implementationReadiness: 90,
      findings: [],
      evidence: validEvidence,
      verdict: 'pass',
    }
    const completeRound = {
      status: 'complete',
      panelists: [
        { id: 'visual', status: 'complete' },
        { id: 'accessibility', status: 'complete' },
        { id: 'implementation', status: 'complete' },
      ],
    }
    const completedSession = {
      id: 'crit_session_test_01',
      briefId: brief.id,
      status: 'completed',
      artifactId: evidenceArtifact.id,
      artifactRevision: evidenceArtifact.revision,
      finalCritiqueClaimed: true,
      rounds: [completeRound, completeRound],
      finishedAt: '2026-07-15T00:00:05.000Z',
    }
    const missingSessionCritique = await (workspace.recordCritique as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)({
      artifact: evidenceArtifact,
      critique: passingCritique,
      runId: 'run_test_01',
      threadId: brief.threadId,
    })
    assert.equal(missingSessionCritique.ok, false)
    if (!missingSessionCritique.ok) assert.equal(missingSessionCritique.code, 'CRITIQUE_SESSION_REQUIRED')
    const incompleteSessionCritique = await (workspace.recordCritique as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)({
      artifact: evidenceArtifact,
      critique: passingCritique,
      critiqueSession: { ...completedSession, rounds: [completeRound, { ...completeRound, status: 'active' }] },
      runId: 'run_test_01',
      threadId: brief.threadId,
    })
    assert.equal(incompleteSessionCritique.ok, false)
    if (!incompleteSessionCritique.ok) assert.equal(incompleteSessionCritique.code, 'CRITIQUE_SESSION_INCOMPLETE')
    for (const status of ['interrupted', 'failed']) {
      const rejectedSessionCritique = await (workspace.recordCritique as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)(
        { artifact: evidenceArtifact, critique: passingCritique, critiqueSession: { ...completedSession, status }, runId: 'run_test_01', threadId: brief.threadId },
      )
      assert.equal(rejectedSessionCritique.ok, false)
      if (!rejectedSessionCritique.ok) assert.equal(rejectedSessionCritique.code, 'CRITIQUE_SESSION_INCOMPLETE')
    }
    const pending = await workspace.evaluateDelivery({
      artifact: evidenceArtifact,
      critique: { ...passingCritique, verdict: 'needs-revision' },
    })
    assert.equal(pending.ok, false)
    const running = await workspace.evaluateDelivery({ artifact: evidenceArtifact, critique: passingCritique, critiqueSession: { ...completedSession, status: 'running' } })
    assert.equal(running.ok, false)
    const staleDelivery = await workspace.evaluateDelivery({ artifact: { ...evidenceArtifact, revision: evidenceArtifact.revision + 1 }, critique: passingCritique })
    assert.equal(staleDelivery.ok, false)
    const missingSession = await workspace.evaluateDelivery({ artifact: evidenceArtifact, critique: passingCritique })
    assert.equal(missingSession.ok, false)

    const canonicalBlockedCritique = { ...passingCritique, verdict: 'needs-revision', createdAt: '2026-07-15T00:00:04.000Z' }
    assert.equal((await workspace.recordCritique({ artifact: evidenceArtifact, critique: canonicalBlockedCritique, runId: 'run_test_01', threadId: brief.threadId })).ok, true)
    const forgedDelivery = await workspace.evaluateDelivery({ artifact: evidenceArtifact, critique: passingCritique, critiqueSession: completedSession })
    assert.equal(forgedDelivery.ok, false)

    const canonicalPassingCritique = { ...passingCritique, createdAt: '2026-07-15T00:00:05.000Z' }
    assert.equal((await workspace.recordCritique({ artifact: evidenceArtifact, critique: canonicalPassingCritique, critiqueSession: completedSession, runId: 'run_test_01', threadId: brief.threadId })).ok, true)
    const attestationPath = `.subagents/subdesign/critique-sessions/${evidenceArtifact.id}-r${evidenceArtifact.revision}.json`
    const attestation = JSON.parse(new TextDecoder().decode(await files.readFile(attestationPath))) as Record<string, unknown>
    await files.writeFile(attestationPath, JSON.stringify({ ...attestation, finalCritiqueClaimed: false }))
    const tamperedDelivery = await workspace.evaluateDelivery({ artifact: evidenceArtifact, critique: passingCritique })
    assert.equal(tamperedDelivery.ok, false)
    if (!tamperedDelivery.ok) assert.equal(tamperedDelivery.code, 'DELIVERY_CRITIQUE_SESSION_MISSING')
    assert.equal((await workspace.recordCritique({ artifact: evidenceArtifact, critique: canonicalPassingCritique, critiqueSession: completedSession, runId: 'run_test_01', threadId: brief.threadId })).ok, true)
    const hydratedCritique = (await workspace.readMetadata()).critiques.find((item) => (item as { artifactId?: string }).artifactId === evidenceArtifact.id) as { createdAt?: string } | undefined
    assert.equal(hydratedCritique?.createdAt, '2026-07-15T00:00:05.000Z')
    const ready = await workspace.evaluateDelivery({ artifact: evidenceArtifact, critique: { ...passingCritique, verdict: 'needs-revision' } })
    assert.equal(ready.ok, true)

    const outputPath = path.join(root, 'deliveries', 'approved.pdf')
    const exportableArtifact = evidenceArtifact
    const processes = exportProcesses as Record<string, (input: { suggestedName: string }) => Promise<unknown>>
    processes.pdf = async ({ suggestedName }) => {
      assert.match(suggestedName, /^approved-artifact-r\d+\.pdf$/)
      return { status: 'success', path: outputPath, output: new Uint8Array([80, 68, 70, 45, 49]) }
    }
    const exported = await workspace.exportArtifact({
      artifact: exportableArtifact,
      critique: passingCritique,
      critiqueSession: completedSession,
      format: 'pdf',
      suggestedName: 'approved artifact',
    })
    assert.equal(exported.ok, true)
    assert.equal(fs.existsSync(outputPath), true)

    processes.pdf = async () => ({ status: 'failed', error: 'renderer unavailable' })
    const failedExport = await workspace.exportArtifact({
      artifact: exportableArtifact,
      critique: passingCritique,
      critiqueSession: completedSession,
      format: 'pdf',
      suggestedName: 'approved artifact',
    })
    assert.equal(failedExport.ok, false)
    processes.pdf = async () => ({ status: 'cancelled', error: 'user cancelled' })
    const cancelledExport = await workspace.exportArtifact({ artifact: exportableArtifact, format: 'pdf', suggestedName: 'approved artifact' })
    assert.equal(cancelledExport.ok, false)
    if (!cancelledExport.ok) assert.equal(cancelledExport.code, 'EXPORT_CANCELLED')
    processes.pdf = async () => ({ status: 'unavailable', error: 'renderer unavailable' })
    const unavailableExport = await workspace.exportArtifact({ artifact: exportableArtifact, format: 'pdf', suggestedName: 'approved artifact' })
    assert.equal(unavailableExport.ok, false)
    if (!unavailableExport.ok) assert.equal(unavailableExport.code, 'EXPORT_UNAVAILABLE')
    const afterExport = await workspace.readMetadata()
    assert.equal(afterExport.exports.length, 1)

    processes.pdf = async () => ({ status: 'success', path: outputPath, output: new Uint8Array() })
    const malformedExport = await workspace.exportArtifact({
      artifact: exportableArtifact,
      critique: passingCritique,
      critiqueSession: completedSession,
      format: 'pdf',
      suggestedName: 'approved artifact',
    })
    assert.equal(malformedExport.ok, false)
    assert.match((malformedExport as { error: string }).error, /malformed|格式/i)
  }
}

await files.writeFile('reference.png', png)
const imported = await workspace.importReference({
  briefId: brief.id,
  kind: 'screenshot',
  source: 'reference.png',
  suggestedTitle: 'Reference shot',
})
assert.equal(imported.ok, true)
if (imported.ok) {
  assert.equal(imported.reference.kind, 'screenshot')
  assert.match(imported.designSystem.content, /Reference content SHA-256/)
  assert.equal((await files.exists(imported.reference.storedPath)), true)
}
const missingBriefReference = await workspace.importReference({
  briefId: 'brief_missing',
  kind: 'screenshot',
  source: 'reference.png',
})
assert.equal(missingBriefReference.ok, false)
const unsafeReference = await workspace.importReference({
  briefId: brief.id,
  kind: 'screenshot',
  source: '../escape.png',
})
assert.equal(unsafeReference.ok, false)

const wrongDesignSystemScope = await (workspace.createDesignSystem as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)({
  id: 'scoped-brand',
  title: 'Scoped Brand',
  briefId: brief.id,
  runId: 'run_other_01',
  threadId: 'thread_other_01',
})
assert.equal(wrongDesignSystemScope.ok, false)
if (!wrongDesignSystemScope.ok) assert.equal(wrongDesignSystemScope.code, 'RUN_SCOPE_MISMATCH')
const scopedDesignSystem = await (workspace.createDesignSystem as (input: Record<string, unknown>) => Promise<{ ok: boolean; path?: string }>)({
  id: 'scoped-brand',
  title: 'Scoped Brand',
  briefId: brief.id,
  runId: 'run_test_01',
  threadId: brief.threadId,
})
assert.equal(scopedDesignSystem.ok, true)
const wrongDesignSystemUpdate = await (workspace.updateDesignSystem as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)({
  id: 'scoped-brand',
  content: '# Wrong Scope\n',
  briefId: brief.id,
  runId: 'run_other_01',
  threadId: 'thread_other_01',
})
assert.equal(wrongDesignSystemUpdate.ok, false)
if (!wrongDesignSystemUpdate.ok) assert.equal(wrongDesignSystemUpdate.code, 'RUN_SCOPE_MISMATCH')

const createdDesignSystem = await workspace.createDesignSystem({ id: 'workspace-brand', title: 'Workspace Brand', content: '# Workspace Brand\n' })
assert.equal(createdDesignSystem.ok, true)
if (createdDesignSystem.ok) assert.equal(new TextDecoder().decode(await files.readFile(createdDesignSystem.path)), '# Workspace Brand\n')
const updatedDesignSystem = await workspace.updateDesignSystem({ id: 'workspace-brand', content: '# Workspace Brand Updated\n' })
assert.equal(updatedDesignSystem.ok, true)
if (updatedDesignSystem.ok) assert.equal(new TextDecoder().decode(await files.readFile(updatedDesignSystem.path)), '# Workspace Brand Updated\n')

const vendorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subdesign-vendor-'))
fs.mkdirSync(path.join(vendorRoot, 'brand'), { recursive: true })
fs.writeFileSync(path.join(vendorRoot, 'brand', 'DESIGN.md'), '# Vendor Brand\n')
fs.writeFileSync(path.join(vendorRoot, 'brand', 'tokens.css'), ':root { --brand: #123456; }\n')
const vendor = {
  exists: async (relativePath: string) => fs.existsSync(path.resolve(vendorRoot, relativePath)),
  readFile: async (relativePath: string) => fs.readFileSync(path.resolve(vendorRoot, relativePath)),
  stat: async (relativePath: string) => {
    const stat = fs.statSync(path.resolve(vendorRoot, relativePath))
    return { isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size }
  },
  isPathInside: async (relativePath: string) => {
    const target = path.resolve(vendorRoot, relativePath)
    return target === vendorRoot || target.startsWith(`${vendorRoot}${path.sep}`)
  },
}
const installed = await workspace.installDesignSystemPack({
  sourcePath: 'brand',
  assetPaths: ['brand/DESIGN.md', 'brand/tokens.css'],
  targetId: 'vendor-brand',
  digest: '1234567890abcdef',
  kind: 'design-system',
  vendor,
})
assert.equal(installed.ok, true)
if (installed.ok) {
  assert.equal(installed.designSystemPath, '.subagents/subdesign/design-systems/vendor-brand/DESIGN.md')
  assert.equal(await files.exists(installed.designSystemPath), true)
  assert.equal(new TextDecoder().decode(fs.readFileSync(path.join(vendorRoot, 'brand', 'DESIGN.md'))), '# Vendor Brand\n')
}
const unsafePunctuationInstall = await workspace.installDesignSystemPack({
  sourcePath: 'brand',
  assetPaths: ['brand/DESIGN.md'],
  targetId: 'vendor!brand',
  digest: '1234567890abcdef',
  kind: 'design-system',
  vendor,
})
assert.equal(unsafePunctuationInstall.ok, false)
if (!unsafePunctuationInstall.ok) assert.equal(unsafePunctuationInstall.code, 'VENDOR_TARGET_INVALID')
const duplicateInstall = await workspace.installDesignSystemPack({
  sourcePath: 'brand',
  assetPaths: ['brand/DESIGN.md'],
  targetId: 'vendor-brand',
  digest: '1234567890abcdef',
  kind: 'design-system',
  vendor,
})
assert.equal(duplicateInstall.ok, false)
const unsafeInstall = await workspace.installDesignSystemPack({
  sourcePath: 'brand',
  assetPaths: ['brand/DESIGN.md'],
  targetId: '../escape',
  digest: '1234567890abcdef',
  kind: 'design-system',
  vendor,
})
assert.equal(unsafeInstall.ok, false)

const registeredArtifact = {
  ...artifact,
  id: 'artifact_registered_01',
  entry: 'artifacts/registered.html',
}
const wrongRegistered = await (workspace.registerArtifact as (input: Record<string, unknown>) => Promise<{ ok: boolean; code?: string }>)({
  artifact: registeredArtifact,
  briefId: brief.id,
  runId: 'run_other_01',
  threadId: 'thread_other_01',
})
assert.equal(wrongRegistered.ok, false)
if (!wrongRegistered.ok) assert.equal(wrongRegistered.code, 'RUN_SCOPE_MISMATCH')
const registered = await workspace.registerArtifact({ artifact: registeredArtifact, briefId: brief.id })
assert.equal(registered.ok, true)
if (registered.ok) assert.equal(registered.artifact.id, registeredArtifact.id)

const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subdesign-workspace-second-'))
const secondFiles = createTempFileStore(secondRoot)
const secondWorkspace = createSubDesignProjectWorkspace({ files: secondFiles, clock: () => '2026-07-15T00:00:01.000Z', crypto: fixedCrypto })
const secondBrief = { ...brief, id: 'brief_test_02', threadId: 'thread_test_02', selectedDirectionId: 'direction_01', directions: [{ id: 'direction_01', title: 'Calm', summary: '安靜' }], stage: 'build' }
const secondArtifact = { ...artifact, id: 'artifact_test_02', briefId: secondBrief.id, entry: 'artifacts/second.html' }
assert.equal((await secondWorkspace.createBrief({ brief: secondBrief, runId: 'run_second_01', threadId: secondBrief.threadId })).ok, true)
assert.equal((await secondWorkspace.registerArtifact({ artifact: secondArtifact, briefId: secondBrief.id, runId: 'run_second_01', threadId: secondBrief.threadId })).ok, true)
await secondFiles.writeFile(secondArtifact.entry, '<html><body>Second</body></html>')
const secondPatched = await secondWorkspace.patchArtifact({ artifact: secondArtifact, operations: [{ path: secondArtifact.entry, find: 'Second', replace: 'Second updated' }] })
assert.equal(secondPatched.ok, true)
assert.match(new TextDecoder().decode(await files.readFile(entryPath)), /Size=7/)
assert.match(new TextDecoder().decode(await secondFiles.readFile(secondArtifact.entry)), /Second updated/)

console.log('SubDesign project workspace smoke: ok')
