/**
 * Ticket 04: learning-loop exports must stay inside the resolved project root.
 * Follows the real-filesystem path assertions in smoke-sanitized-workspace.mts —
 * traversal, absolute paths and symlink escapes are each refused before a write.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeLearningExport } from '../electron/learningExportWrite.ts'
import { writeSettingsBundleExport } from '../electron/settingsBundleExportWrite.ts'
import {
  buildLearningExportPlan,
  isSafeLearningExportPath,
  safeLearningName,
} from '../src/agent/hermes/learningExport.ts'

let passed = 0
const check = (label: string, fn: () => void) => {
  try {
    fn()
  } catch (error) {
    console.error(`smoke-learning-export FAILED: ${label}`)
    throw error
  }
  passed += 1
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-export-'))
const projectRoot = path.join(tmp, 'project')
const outside = path.join(tmp, 'outside')
fs.mkdirSync(projectRoot, { recursive: true })
fs.mkdirSync(outside, { recursive: true })
const resolveRoot = () => projectRoot

check('names never become more than one path segment', () => {
  assert.equal(safeLearningName('../../etc/passwd'), null)
  assert.equal(safeLearningName('a/b'), null)
  assert.equal(safeLearningName('..'), null)
  assert.equal(safeLearningName(''), null)
  assert.equal(safeLearningName('my skill!'), 'my-skill')
})

check('only .subagents-relative paths are accepted', () => {
  assert.equal(isSafeLearningExportPath('.subagents/skills/x/SKILL.md'), true)
  assert.equal(isSafeLearningExportPath('.subagents/../../etc/passwd'), false)
  assert.equal(isSafeLearningExportPath('docs/notes.md'), false)
  assert.equal(isSafeLearningExportPath('/etc/passwd'), false)
})

check('a real write lands under the project root', () => {
  const result = writeLearningExport(
    { relativePath: '.subagents/skills/demo/SKILL.md', content: '# demo\n' },
    resolveRoot,
  )
  assert.equal(result.ok, true)
  const written = path.join(projectRoot, '.subagents/skills/demo/SKILL.md')
  assert.equal(fs.existsSync(written), true)
  assert.equal(fs.readFileSync(written, 'utf8'), '# demo\n')
  if (process.platform !== 'win32') assert.equal(fs.statSync(written).mode & 0o777, 0o600)
  // physically inside, not merely lexically
  assert.equal(fs.realpathSync(written).startsWith(fs.realpathSync(projectRoot)), true)
})

check('oversized exports fail without creating a misleading empty file', () => {
  const relativePath = '.subagents/memory/oversized.json'
  const result = writeLearningExport(
    { relativePath, content: 'x'.repeat(16 * 1024 * 1024 + 1) },
    resolveRoot,
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /大小上限/)
  assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), false)
})

check('Settings bundle writer uses the chosen JSON path with restrictive permissions', () => {
  const target = path.join(outside, 'settings-backup.json')
  const result = writeSettingsBundleExport(target, '{"version":3}\n')
  assert.equal(result.ok, true)
  assert.equal(fs.readFileSync(target, 'utf8'), '{"version":3}\n')
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600)
  const refused = writeSettingsBundleExport(path.join(outside, 'not-json.txt'), '{}')
  assert.equal(refused.ok, false)
})

check('an existing file is never silently overwritten', () => {
  const again = writeLearningExport(
    { relativePath: '.subagents/skills/demo/SKILL.md', content: '# replaced\n' },
    resolveRoot,
  )
  assert.equal(again.ok, false)
  if (!again.ok) assert.equal(again.exists, true)
  assert.equal(
    fs.readFileSync(path.join(projectRoot, '.subagents/skills/demo/SKILL.md'), 'utf8'),
    '# demo\n',
    'refused write must not have touched the file',
  )
  const forced = writeLearningExport(
    { relativePath: '.subagents/skills/demo/SKILL.md', content: '# replaced\n', overwrite: true },
    resolveRoot,
  )
  assert.equal(forced.ok, true)
})

check('traversal is refused and writes nothing', () => {
  const escape = path.join(outside, 'escaped.md')
  for (const relativePath of [
    '.subagents/../../outside/escaped.md',
    '.subagents/skills/../../../outside/escaped.md',
    '../outside/escaped.md',
  ]) {
    const result = writeLearningExport({ relativePath, content: 'pwned' }, resolveRoot)
    assert.equal(result.ok, false, `${relativePath} must be refused`)
  }
  assert.equal(fs.existsSync(escape), false, 'no traversal attempt may create a file')
})

check('absolute paths are refused', () => {
  const target = path.join(outside, 'absolute.md')
  const result = writeLearningExport({ relativePath: target, content: 'pwned' }, resolveRoot)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /絕對路徑|\.subagents/)
  assert.equal(fs.existsSync(target), false)
})

check('a symlinked directory inside the project cannot escape it', () => {
  // lexically ".subagents/skills/link/SKILL.md" is inside the root; physically
  // it is not. path.resolve alone would accept this.
  const linkParent = path.join(projectRoot, '.subagents/skills')
  fs.mkdirSync(linkParent, { recursive: true })
  const link = path.join(linkParent, 'link')
  if (!fs.existsSync(link)) fs.symlinkSync(outside, link, 'dir')

  const result = writeLearningExport(
    { relativePath: '.subagents/skills/link/SKILL.md', content: 'pwned' },
    resolveRoot,
  )
  assert.equal(result.ok, false, 'symlink escape must be refused')
  assert.equal(fs.existsSync(path.join(outside, 'SKILL.md')), false)
})

check('the export plan only ever emits confined paths', () => {
  const files = buildLearningExportPlan({
    skills: [
      { meta: { name: '../../evil' }, body: 'x', raw: '' },
      { meta: { name: 'good skill' }, body: 'body', raw: '' },
    ] as never,
    memory: { userProfile: 'u', memory: 'm' } as never,
  })
  for (const file of files) {
    assert.equal(isSafeLearningExportPath(file.relativePath), true, file.relativePath)
    assert.equal(writeLearningExport({ ...file, overwrite: true }, resolveRoot).ok, true)
  }
  assert.equal(files.some((file) => file.relativePath.includes('evil')), false)
})

check('memory UI exports from Host canonical memory and never renderer MemoryBundle', () => {
  const learningSource = fs.readFileSync(new URL('../src/pages/LearningPage.tsx', import.meta.url), 'utf8')
  const settingsStoreSource = fs.readFileSync(new URL('../src/store/settingsStore.ts', import.meta.url), 'utf8')
  const preloadSource = fs.readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  assert.match(learningSource, /memoryProjection\?\.exportBundle/)
  assert.match(settingsStoreSource, /memoryProjection\?\.exportBundle/)
  assert.match(preloadSource, /pi-host:memory-projection:export/)
  assert.match(preloadSource, /settings:export-bundle/)
  assert.doesNotMatch(settingsStoreSource, /Includes hermes skills\/memory/)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`smoke-learning-export: ${passed} groups passed`)
