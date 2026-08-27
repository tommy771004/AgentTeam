import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const packageSource = await readFile(join(appRoot, 'package.json'), 'utf8')
assert.match(packageSource, /"smoke:verified-memory-lifecycle"/,
  'full lifecycle qualification must be named in the production smoke graph')

const runNode = (script: string): Promise<void> => new Promise((done, reject) => {
  const child = spawn(process.execPath, ['--experimental-strip-types', join(appRoot, 'scripts', script)], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${script} failed: code=${code} signal=${signal}`)))
})

// These are shipped workflows, not helper replicas. Together they exercise
// the canonical coordinator/Host admission and the same persisted protocols.
for (const script of [
  'smoke-pi-working-state-completion.mts',
  'smoke-pi-skill-preflight-redraft.mts',
  'smoke-pi-skill-preflight-batch.mts',
  'smoke-pi-delegated-goal-host.mts',
  'smoke-memory-control-meta-agent.mts',
  'smoke-memory-control-evaluation-gate.mts',
  'smoke-runner-contract.mts',
  'smoke-record-fidelity-qualification.mts',
]) await runNode(script)

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path))
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(path)
  }
  return result
}

const productionSources = await sourceFiles(join(appRoot, 'src'))
const electronSources = await sourceFiles(join(appRoot, 'electron'))
const content = new Map<string, string>()
for (const path of [...productionSources, ...electronSources]) content.set(path, await readFile(path, 'utf8'))

const hostProtocolPath = join(appRoot, 'electron', 'piHostProtocol.ts')
const hostProtocol = content.get(hostProtocolPath) || ''
const nonHostProduction = [...content.entries()].filter(([path]) => path !== hostProtocolPath)
assert.equal(nonHostProduction.filter(([, source]) => /\bcreateInitialWorkingState\s*\(/.test(source)).length, 1,
  'only the pure Working State vocabulary may define creation outside the Host')
assert.ok(nonHostProduction.find(([path, source]) => path.endsWith('/workingState.ts') && /export function createInitialWorkingState/.test(source)))
assert.doesNotMatch(nonHostProduction.map(([, source]) => source).join('\n'), /\brecordTurnEntry\s*\(/,
  'renderer and compatibility code cannot author a second Pi timeline')
assert.match(hostProtocol, /checkWorkingStateProposal\s*\(/)
assert.match(hostProtocol, /kind: 'delegation-check', source: 'host'/)
assert.match(hostProtocol, /kind: 'state-check', source: 'host'/)
assert.match(hostProtocol, /kind: 'working-state', source: 'host'/)

let legacyLoopExists = true
try { await access(join(appRoot, 'src', 'agent', 'loop')) } catch { legacyLoopExists = false }
assert.equal(legacyLoopExists, false, 'the removable compatibility loop cannot regain production ownership')

const memoryControlFiles = [...content.entries()].filter(([path]) => /memoryControl/i.test(path))
const memoryControlSource = memoryControlFiles.map(([, source]) => source).join('\n')
assert.doesNotMatch(memoryControlSource, /sqliteDurableMemory|DurableMemoryStore|memoryExport|memoryImport|LearningPage|SettingsPage/,
  'Memory-Control qualification must not take durable-memory SQLite, CRUD/export, or Learning/Settings ownership')
for (const [path, source] of content) {
  if (!/sqliteDurableMemoryStore|durableMemoryStore|memoryImport|memoryExport|LearningPage|SettingsPage/.test(path)) continue
  assert.doesNotMatch(source, /createMemoryControlMetaCandidate|MemoryControlPackageRepository/,
    `durable-memory or UI owner must not become a parallel Memory-Control authority: ${path}`)
}

for (const gated of [
  'smoke-pi-working-state-completion.mts',
  'smoke-pi-skill-preflight-redraft.mts',
  'smoke-pi-skill-preflight-batch.mts',
  'smoke-pi-delegated-goal-host.mts',
  'smoke-memory-control-package-repository.mts',
  'smoke-memory-control-package-lifecycle.mts',
  'smoke-memory-control-evaluation-gate.mts',
  'smoke-memory-control-meta-agent.mts',
  'smoke-runner-contract.mts',
  'smoke-record-fidelity-qualification.mts',
]) assert.ok(packageSource.includes(gated), `${gated} is not reachable from the production smoke graph`)

console.log('Verified Working Memory full lifecycle qualification: 8 real workflows + ownership/gating drift guards passed')
