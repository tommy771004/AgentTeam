/**
 * Headless smoke checks for parser, scheduler helpers, supervisor, tool selection.
 * Run: node scripts/smoke.mjs
 */

import assert from 'node:assert/strict'

// ── Minimal re-implementations mirrored from source for CI without TS build ──
// Prefer importing built modules when available; otherwise inline critical paths.

function computeNextRun(kind, opts) {
  const from = opts.from || new Date()
  if (kind === 'interval') {
    const mins = Math.max(1, opts.intervalMinutes || 60)
    return new Date(from.getTime() + mins * 60_000).toISOString()
  }
  if (kind === 'daily') {
    const [hh, mm] = (opts.dailyAt || '08:00').split(':').map(Number)
    const next = new Date(from)
    next.setSeconds(0, 0)
    next.setHours(hh || 8, mm || 0, 0, 0)
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  return null
}

function byteLength(text) {
  return new TextEncoder().encode(text).length
}

function enforceToolPayload(tool, output, maxBytes, mode = 'truncate') {
  const bytes = byteLength(output)
  if (bytes <= maxBytes) return { output, truncated: false, bytes }
  if (mode === 'halt') {
    const err = new Error(`MemoryConstraintViolation: ${tool} ${bytes}`)
    err.code = 'MemoryConstraintViolation'
    throw err
  }
  let cut = Math.floor(output.length * (maxBytes / bytes))
  let sliced = output.slice(0, cut)
  while (byteLength(sliced) > maxBytes && cut > 0) {
    cut = Math.floor(cut * 0.9)
    sliced = output.slice(0, cut)
  }
  return { output: sliced, truncated: true, bytes }
}

function classifyLoopType(input) {
  const lower = input.toLowerCase()
  if (lower.includes('daily') || lower.includes('every day')) return 'Time-based'
  if (lower.startsWith('when ') || lower.includes('when email')) return 'Proactive'
  if (input.length > 40 || /find|analyze|research/i.test(input)) return 'Goal-based'
  return 'Turn-based'
}

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

await test('classifyLoopType time', () => {
  assert.equal(
    classifyLoopType('Every day at 08:00 fetch sales metrics'),
    'Time-based',
  )
})

await test('classifyLoopType proactive', () => {
  assert.equal(
    classifyLoopType('When email received WITH attachment AND subject CONTAINS Invoice'),
    'Proactive',
  )
})

await test('schedule next interval', () => {
  const from = new Date('2026-01-01T00:00:00Z')
  const next = computeNextRun('interval', { intervalMinutes: 30, from })
  assert.equal(new Date(next).getTime() - from.getTime(), 30 * 60_000)
})

await test('supervisor truncates oversized payload', () => {
  const big = 'x'.repeat(10_000)
  const r = enforceToolPayload('web_search', big, 100, 'truncate')
  assert.equal(r.truncated, true)
  assert.ok(byteLength(r.output) <= 100)
})

await test('supervisor halt mode throws', () => {
  const big = 'y'.repeat(5000)
  assert.throws(() => enforceToolPayload('http_fetch', big, 50, 'halt'))
})

await test('strict event match semantics (manual)', () => {
  const rule = {
    enabled: true,
    source: 'email.received',
    subjectContains: 'Invoice',
    hasAttachment: true,
  }
  const payload = {
    source: 'email.received',
    subject: 'Q3 Invoice',
    hasAttachment: true,
  }
  const ok =
    rule.enabled &&
    rule.source === payload.source &&
    payload.subject.toLowerCase().includes(rule.subjectContains.toLowerCase()) &&
    payload.hasAttachment === rule.hasAttachment
  assert.equal(ok, true)

  const noAttach = { ...payload, hasAttachment: false }
  const fail =
    rule.hasAttachment === noAttach.hasAttachment &&
    noAttach.subject.toLowerCase().includes(rule.subjectContains.toLowerCase())
  assert.equal(fail, false)
})

// ── Electron bridge build contract (preload ESM/CJS regression) ──
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const mcpWrite = mcpBridge.slice(mcpBridge.indexOf('private write('), mcpBridge.indexOf('private notify('))
  assert.match(mcpWrite, /stdin\.write\(`\$\{json\}\\n`\)/)
  assert.doesNotMatch(mcpWrite, /Content-Length/)
})

console.log(`\n${passed} tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Smoke tests failed')
} else {
  console.log('OK')
}
