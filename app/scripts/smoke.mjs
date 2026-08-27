/**
 * Headless smoke checks for parser, scheduler helpers, and event matching.
 * Run: node scripts/smoke.mjs
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Import the actual TypeScript seams. The plain `node` entry re-execs itself
// with Node's built-in type stripping so this smoke cannot silently drift into
// a hand-maintained mirror of scheduler/parser/eventMatcher logic.
if (!process.execArgv.includes('--experimental-strip-types')) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  process.exit(child.status ?? 1)
}

const [{ computeNextRun }, { classifyLoopType, detectAutomationSuggestion }, { matchProactiveEvent }] = await Promise.all([
  import('../src/agent/scheduler.ts'),
  import('../src/agent/parser.ts'),
  import('../src/agent/eventMatcher.ts'),
])

// ── Tests ───────────────────────────────────────────────────────

let passed = 0
let skipped = 0
const requireBuilt = process.argv.includes('--require-built')

function skip(reason) {
  return { skipped: true, reason }
}

async function test(name, fn) {
  try {
    const result = await fn()
    if (result?.skipped) {
      console.log(`  · ${name} (skipped: ${result.reason})`)
      skipped++
      return
    }
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}

console.log('SubAgents AI smoke tests\n')

await test('classifyLoopType goal', () => {
  assert.equal(
    classifyLoopType('Find me 3 AI editing software tools and compare prices'),
    'Goal-based',
  )
})

await test('conversation schedule becomes a suggestion, not Time-based', () => {
  const input = 'Every day at 08:00 fetch sales metrics'
  assert.equal(
    classifyLoopType(input),
    'Goal-based',
  )
  assert.equal(detectAutomationSuggestion(input)?.kind, 'schedule')
})

await test('conversation event becomes a suggestion, not Proactive', () => {
  const input = 'When email received WITH attachment AND subject CONTAINS Invoice'
  assert.equal(
    classifyLoopType(input),
    'Goal-based',
  )
  assert.equal(detectAutomationSuggestion(input)?.kind, 'event')
})

await test('schedule next interval', () => {
  const from = new Date('2026-01-01T00:00:00Z')
  const next = computeNextRun('interval', { intervalMinutes: 30, from })
  assert.equal(new Date(next).getTime() - from.getTime(), 30 * 60_000)
})

 await test('strict event match semantics use the real matcher', () => {
  const rule = {
    id: 'event_invoice',
    name: 'Invoice received',
    enabled: true,
    source: 'email.received',
    subjectContains: 'Invoice',
    hasAttachment: true,
  }
  const payload = {
    source: 'email.received',
    subject: 'Q3 Invoice',
    hasAttachment: true,
    receivedAt: '2026-01-01T00:00:00.000Z',
  }
  assert.ok(matchProactiveEvent(rule, payload))

  const noAttach = { ...payload, hasAttachment: false }
  assert.equal(matchProactiveEvent(rule, noAttach), null)
})

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distElectron = path.join(appRoot, 'dist-electron')
const mainPath = path.join(distElectron, 'main.js')
const preloadCjs = path.join(distElectron, 'preload.cjs')
const preloadMjs = path.join(distElectron, 'preload.mjs')

await test('electron preload is CJS (.cjs), not broken .mjs+require', () => {
  // Only enforce when dist has been built (dev/CI after vite electron build)
  if (!fs.existsSync(distElectron)) {
    if (requireBuilt) assert.fail('dist-electron must exist after npm run build')
    return skip('dist-electron not built yet')
  }
  assert.equal(
    fs.existsSync(preloadCjs),
    true,
    'dist-electron/preload.cjs must exist (contextBridge entry)',
  )
  if (fs.existsSync(preloadMjs)) {
    const mjs = fs.readFileSync(preloadMjs, 'utf8')
    if (/\brequire\s*\(/.test(mjs)) {
      assert.fail(
        'dist-electron/preload.mjs uses require() under ESM — this breaks window.subagents. Use preload.cjs only.',
      )
    }
  }
  const cjs = fs.readFileSync(preloadCjs, 'utf8')
  assert.match(cjs, /require\s*\(\s*['"]electron['"]\s*\)|from\s+['"]electron['"]/)
  assert.match(cjs, /exposeInMainWorld\s*\(\s*[`'"]subagents[`'"]/)
})

await test('electron bridge is ESM/CJS-safe and Windows core paths avoid POSIX shell syntax', () => {
  if (!fs.existsSync(mainPath)) {
    if (requireBuilt) assert.fail('dist-electron/main.js must exist after npm run build')
    return skip('dist-electron/main.js not built yet')
  }
  const main = fs.readFileSync(mainPath, 'utf8')
  assert.match(main, /^import\s/m, 'main.js should be ESM (import …)')
  assert.equal(
    /\brequire\s*\(\s*['"]electron['"]\s*\)/.test(main),
    false,
    'main.js must not require("electron") under package type:module',
  )
  assert.match(
    main,
    /preload\.cjs/,
    'main must reference preload.cjs (not preload.mjs)',
  )
  assert.equal(
    /preload\.mjs/.test(main),
    false,
    'main must not load preload.mjs',
  )
  const projectBridge = fs.readFileSync(path.join(appRoot, 'electron/projectBridge.ts'), 'utf8')
  const localCliRunner = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  const codegraphBridge = fs.readFileSync(path.join(appRoot, 'electron/codegraphBridge.ts'), 'utf8')
  const platformProcess = fs.readFileSync(path.join(appRoot, 'electron/platformProcess.ts'), 'utf8')
  const mcpBridge = fs.readFileSync(path.join(appRoot, 'electron/mcpBridge.ts'), 'utf8')
  assert.doesNotMatch(projectBridge, /2>\/dev\/null|\| head|\|\| true/)
  assert.match(platformProcess, /process\.platform === 'win32'/)
  assert.match(localCliRunner, /executableLookupCommand/)
  assert.match(codegraphBridge, /executableLookupCommand/)
  // CLI 0.9/1.x: status/init/sync use positional path — never `status -p` (rejects on 0.9)
  assert.match(codegraphBridge, /status \$\{quoteShellArg/)
  assert.doesNotMatch(codegraphBridge, /status -p |init -p |sync -p |explore -p /)
  // explore falls back to query on older CLIs
  assert.match(codegraphBridge, /supportsExplore|unknown command/)
  assert.match(codegraphBridge, /runWithOptionalPathFlag|fallback/)
  const mcpWrite = mcpBridge.slice(mcpBridge.indexOf('private write('), mcpBridge.indexOf('private notify('))
  assert.match(mcpWrite, /stdin\.write\(`\$\{json\}\\n`\)/)
  assert.doesNotMatch(mcpWrite, /Content-Length/)
})

await test('every ipcMain channel is registered exactly once across the main process', () => {
  const seen = new Map()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(p, 'utf8')
        for (const match of source.matchAll(/ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)) {
          if (seen.has(match[1])) {
            assert.fail(`channel '${match[1]}' registered twice (${seen.get(match[1])} and ${p}) — Electron throws 'Attempted to register a second handler' at startup`)
          }
          seen.set(match[1], p)
        }
      }
    }
  }
  walk(path.join(appRoot, 'electron'))
})

console.log(`\n${passed} tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Smoke tests failed')
} else {
  console.log('OK')
}
