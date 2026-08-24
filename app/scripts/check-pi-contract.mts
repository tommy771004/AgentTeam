import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

/**
 * Contract drift guards（契約漂移守衛）for the expand–contract effort
 * "Pi Host tool and skill parity".
 *
 * The Host owns the tool catalog and skill discovery now (ADR-0027/0034).
 * These guards make the two-catalog split impossible to rebuild quietly:
 * each one pins a removal or a freeze so only an explicit edit to THIS file
 * can move the boundary.
 */

// ── Guard 1: the renderer registration directory is FROZEN ──
const registeredDir = join(root, 'src/agent/tools/registered')
const registeredFiles = readdirSync(registeredDir).filter((file) => file.endsWith('.ts') && file !== 'index.ts').sort()
const FROZEN_REGISTERED = [
  // Non-equivalent workspace tools (issue 09): no Pi builtin counterpart.
  'workspace_delete.ts',
  'workspace_diff.ts',
  'workspace_download.ts',
  'workspace_mkdir.ts',
  'workspace_move.ts',
  // Remaining packs whose renderer handlers still serve browser degrade.
  ...readdirSync(registeredDir).filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .filter((file) => !file.startsWith('workspace_')).sort(),
]
assert.deepEqual(registeredFiles, [...new Set(FROZEN_REGISTERED)].sort(), 'agent/tools/registered is frozen: a NEW renderer tool registration appeared — the Host catalog is the only catalog (ADR-0028). Remove it, or extend this contract explicitly.')

// ── Guard 2: removed equivalents stay removed ──
for (const removed of ['workspace_read.ts', 'workspace_list.ts', 'workspace_grep.ts', 'workspace_glob.ts', 'workspace_write.ts', 'bash.ts', 'skill_list.ts', 'skill_load.ts', 'skill_save.ts']) {
  const path = join(registeredDir, removed)
  assert.equal(existsSync(path), false, `${removed} was removed after parity evidence (ADR-0027 / issue 18); it must not return`)
}

// ── Guard 3: hermes/skills.ts consumer set is FROZEN ──
// ADR-0034 makes Pi's resource loader the ONLY skill discovery path. The
// localStorage copy survives one release READ-ONLY as migration rollback
// (issue 16); its existing consumers may keep reading during that window,
// and nothing new may reference it.
const skillsFile = read('src/agent/hermes/skills.ts')
void skillsFile
const ALLOWED_SKILLS_CONSUMERS = new Set([
  // rollback copy readers + the learning subsystem scheduled for its own removal
  'src/App.tsx',
  'src/store/learningStore.ts',
  'src/pages/SettingsPage.tsx',
  'src/hooks/useSlashExecutor.ts',
  'src/agent/capabilities/runtime.ts',
  'src/agent/intentPreload.ts',
  'src/agent/hermes/curator.ts',
  'src/agent/hermes/learning.ts',
  'src/agent/hermes/promptBuilder.ts',
  'src/agent/hermes/plugins.ts',
  'src/agent/hermes/sessionSearch.ts',
])
const sourceFiles: string[] = []
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) sourceFiles.push(full)
  }
}
walk(join(root, 'src'))
walk(join(root, 'electron'))
const offenders: string[] = []
for (const file of sourceFiles) {
  const rel = file.slice(root.length + 1).replaceAll('\\', '/')
  if (rel === 'src/agent/hermes/skills.ts') continue
  const content = readFileSync(file, 'utf8')
  if (/hermes\/skills/.test(content) && !ALLOWED_SKILLS_CONSUMERS.has(rel)) {
    offenders.push(rel)
  }
}
assert.deepEqual(offenders, [], `hermes/skills gained a new consumer: ${offenders.join(', ')}. Skills are Pi resources (ADR-0034) — do not re-couple the renderer.`)

// ── Guard 4: piTurnContext carries no skill branch ──
const turnContext = read('src/agent/piTurnContext.ts')
assert.doesNotMatch(turnContext, /skillsStore|matchForObjective|selectSkillsForObjective/, 'piTurnContext must not resolve skills renderer-side (issue 18)')
assert.match(turnContext, /Skills are Pi resources/, 'the reason for the removal stays on record where the code lives')

console.log('Pi contract drift guards passed: registrations frozen, equivalents removed, skills discovery single-owner')
