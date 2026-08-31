import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
  buildPackagedFirstTaskEvidence,
  validatePackagedInstallEvidence,
} from './packaged-install-evidence.mjs'

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}`)
    throw error
  }
}

console.log('smoke-packaged-change-evidence')

const firstTask = buildPackagedFirstTaskEvidence({
  resultVisible: true,
  changedFileCount: 1,
  additions: 2,
  removals: 1,
  changedLines: [
    'reports/packaged-smoke-report.md',
    '1  # Packaged install baseline',
    '2  Packaged runtime wrote this report.',
  ],
  firstTaskSessionMessages: 2,
  settingsPersisted: true,
  restartedSessionMessages: 2,
  platform: 'macos',
})

const currentEvidence = {
  schemaVersion: PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
  platform: 'macos',
  firstTask,
  uninstall: { removed: true },
}

test('current evidence carries structured, noise-free change visibility', () => {
  assert.deepEqual(firstTask.change, {
    visible: true,
    changedFileCount: 1,
    additions: 2,
    removals: 1,
    preview: [
      'reports/packaged-smoke-report.md',
      '1  # Packaged install baseline',
      '2  Packaged runtime wrote this report.',
    ].join('\n'),
  })
  assert.doesNotMatch(firstTask.change.preview, /^(?:diff --git |--- |\+\+\+ |@@ )/m)
  assert.equal('diffVisible' in firstTask, false)
  assert.equal('diffPreview' in firstTask, false)
})

test('release consumer accepts the current packaged evidence schema', () => {
  assert.deepEqual(validatePackagedInstallEvidence(currentEvidence, 'macos'), {
    ok: true,
    compatibility: 'current',
    schemaVersion: PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
  })
})

test('legacy evidence requires migration instead of passing silently', () => {
  const legacy = {
    platform: 'macos',
    firstTask: {
      resultVisible: true,
      settingsPersisted: true,
      restartedSessionMessages: 2,
    },
    uninstall: { removed: true },
  }
  assert.deepEqual(validatePackagedInstallEvidence(legacy, 'macos'), {
    ok: false,
    compatibility: 'legacy',
    schemaVersion: null,
    reason: 'Packaged lifecycle evidence uses the legacy diff contract; rerun packaged qualification',
  })
})

test('missing and malformed change evidence fail closed with a reason', () => {
  const missing = validatePackagedInstallEvidence({
    schemaVersion: PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
    platform: 'macos',
    firstTask: { resultVisible: true },
    uninstall: { removed: true },
  }, 'macos')
  assert.equal(missing.ok, false)
  assert.equal(missing.compatibility, 'invalid')
  assert.match(missing.reason, /change evidence/i)

  const noisy = structuredClone(currentEvidence)
  noisy.firstTask.change.preview = '@@ -1 +1 @@\n+replacement'
  const malformed = validatePackagedInstallEvidence(noisy, 'macos')
  assert.equal(malformed.ok, false)
  assert.equal(malformed.compatibility, 'invalid')
  assert.match(malformed.reason, /raw diff headers/i)
})

test('release verifier CLI accepts current evidence and rejects legacy evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-change-evidence-'))
  const currentPath = path.join(root, 'current.json')
  const legacyPath = path.join(root, 'legacy.json')
  try {
    fs.writeFileSync(currentPath, JSON.stringify(currentEvidence))
    fs.writeFileSync(legacyPath, JSON.stringify({
      platform: 'macos',
      firstTask: { resultVisible: true },
      uninstall: { removed: true },
    }))
    const cli = path.resolve('scripts/verify-packaged-install-evidence.mjs')
    const current = spawnSync(process.execPath, [cli, currentPath, 'macos'], { encoding: 'utf8' })
    const legacy = spawnSync(process.execPath, [cli, legacyPath, 'macos'], { encoding: 'utf8' })
    assert.equal(current.status, 0, current.stderr)
    assert.match(current.stdout, /current schema 2/)
    assert.notEqual(legacy.status, 0)
    assert.match(legacy.stderr, /legacy diff contract/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

console.log('smoke-packaged-change-evidence passed (5 checks)')
