/**
 * Outbound Data Gate — ticket 01 pure + wiring smoke.
 * Seams: resolveEffectiveOutboundGuard, inspectOutbound, llm/CLI pre-transport call sites.
 * Run: node --experimental-strip-types scripts/smoke-outbound-gate.mts
 */
import assert from 'node:assert/strict'
import { readSettingsSurface } from './lib/settingsSurface.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseDeployOutboundGuard,
  resolveEffectiveOutboundGuard,
  isProtectionActive,
  parseBuildFlavor,
  inspectOutbound,
  setOutboundGateObserver,
  effectiveOutboundGuardFromSettings,
  settingsPatchFromOutboundStatus,
  applyMainOutboundStatusToSettings,
  type OutboundGuardMode,
} from '../src/agent/outbound/outboundGate.ts'
import { chatCompletionWithTools, DEFAULT_LLM_SETTINGS } from '../src/agent/llm.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-outbound-gate')

await test('parseDeployOutboundGuard: off/demo/optional/required + empty default off', () => {
  assert.equal(parseDeployOutboundGuard(undefined), 'off')
  assert.equal(parseDeployOutboundGuard(''), 'off')
  assert.equal(parseDeployOutboundGuard('  OFF  '), 'off')
  assert.equal(parseDeployOutboundGuard('demo'), 'demo')
  assert.equal(parseDeployOutboundGuard('optional'), 'optional')
  assert.equal(parseDeployOutboundGuard('required'), 'required')
})

await test('parseDeployOutboundGuard: unknown values fail closed (not weaker mode)', () => {
  assert.throws(() => parseDeployOutboundGuard('strict'), /SUBAGENTS_OUTBOUND_GUARD/)
  assert.throws(() => parseDeployOutboundGuard('true'), /SUBAGENTS_OUTBOUND_GUARD/)
  assert.throws(() => parseDeployOutboundGuard('1'), /SUBAGENTS_OUTBOUND_GUARD/)
})

await test('resolveEffectiveOutboundGuard: required always active; optional respects user toggle', () => {
  assert.equal(
    resolveEffectiveOutboundGuard({ deploy: 'required', userEnabled: false }),
    'required',
  )
  assert.equal(
    resolveEffectiveOutboundGuard({ deploy: 'optional', userEnabled: true }),
    'optional',
  )
  assert.equal(
    resolveEffectiveOutboundGuard({ deploy: 'optional', userEnabled: false }),
    'off',
  )
  assert.equal(resolveEffectiveOutboundGuard({ deploy: 'demo' }), 'demo')
  assert.equal(resolveEffectiveOutboundGuard({ deploy: 'off', userEnabled: true }), 'off')
})

await test('isProtectionActive only false for effective off', () => {
  const modes: OutboundGuardMode[] = ['off', 'demo', 'optional', 'required']
  for (const m of modes) {
    assert.equal(isProtectionActive(m), m !== 'off')
  }
})

await test('build flavor is orthogonal to guard mode (unknown fails)', () => {
  assert.equal(parseBuildFlavor(undefined), 'standard')
  assert.equal(parseBuildFlavor(''), 'standard')
  assert.equal(parseBuildFlavor('standard'), 'standard')
  assert.equal(parseBuildFlavor('policy-admin'), 'policy-admin')
  assert.throws(() => parseBuildFlavor('pro'), /SUBAGENTS_BUILD_FLAVOR/)
  // flavor must not imply a guard mode
  assert.equal(resolveEffectiveOutboundGuard({ deploy: 'off' }), 'off')
})

await test('inspectOutbound: off bypasses (inspected false); other modes enter gate', () => {
  const payload = { messages: [{ role: 'user', content: 'hello' }] }
  const off = inspectOutbound({
    channel: 'llm',
    payload,
    effectiveMode: 'off',
    buildFlavor: 'standard',
  })
  assert.equal(off.action, 'allow')
  if (off.action === 'allow') {
    assert.equal(off.inspected, false)
    assert.equal(off.effectiveMode, 'off')
    assert.deepEqual(off.payload, payload)
  }

  for (const mode of ['demo', 'optional', 'required'] as const) {
    const r = inspectOutbound({
      channel: 'llm',
      payload,
      effectiveMode: mode,
      buildFlavor: 'policy-admin', // admin flavor still must enter gate
    })
    assert.equal(r.action, 'allow', mode)
    if (r.action === 'allow') {
      assert.equal(r.inspected, true, mode)
      assert.equal(r.effectiveMode, mode)
      assert.deepEqual(r.payload, payload)
    }
  }
})

await test('inspectOutbound: CLI channel uses same gate contract', () => {
  const r = inspectOutbound({
    channel: 'cli',
    payload: { prompt: 'run tests', cwd: '/tmp/proj' },
    effectiveMode: 'required',
    buildFlavor: 'standard',
  })
  assert.equal(r.action, 'allow')
  if (r.action === 'allow') assert.equal(r.inspected, true)
})

await test('wiring: llm.ts and localCliRun call inspectOutbound before transport', () => {
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const cli = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  assert.match(llm, /inspectOutbound/)
  assert.match(llm, /channel:\s*['"]llm['"]/)
  assert.match(cli, /inspectOutbound/)
  assert.match(cli, /channel:\s*['"]cli['"]/)
  // must not reintroduce a parallel dispatch from UI pages
  assert.doesNotMatch(llm, /runDelegatedTask/)
})

await test('settings surface: outboundProtectionEnabled + deploy/flavor types exist', () => {
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const defaults = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const page = readSettingsSurface(appRoot)
  assert.match(types, /outboundProtectionEnabled:\s*boolean/)
  assert.match(defaults, /outboundProtectionEnabled:\s*false/)
  assert.match(page, /outboundProtectionEnabled/)
  assert.match(page, /公司強制|demo|出站/)
})

await test('scenario: each LLM transport crosses the gate exactly once (observer)', async () => {
  const events: Array<{ channel: string; inspected: boolean }> = []
  setOutboundGateObserver((e) => {
    events.push({ channel: e.channel, inspected: e.inspected })
  })
  const g = globalThis as typeof globalThis & {
    window?: {
      subagents?: { llm?: { chat: (body: unknown) => Promise<unknown> } }
    }
  }
  const prev = g.window
  g.window = {
    subagents: {
      llm: {
        chat: async () => ({ content: 'ok', tokensUsed: 1, model: 'm', toolCalls: [] }),
      },
    },
  }
  try {
    const settings = {
      ...DEFAULT_LLM_SETTINGS,
      enabled: true,
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:9',
      outboundGuardDeploy: 'off' as const,
      outboundProtectionEnabled: false,
    }
    await chatCompletionWithTools(settings, [{ role: 'user', content: 'hi' }], [])
    await chatCompletionWithTools(settings, [{ role: 'user', content: 'again' }], [])
    assert.equal(events.length, 2, 'two LLM rounds → two gate hits')
    assert.ok(events.every((e) => e.channel === 'llm'))
    // off → inspected false (bypass path still recorded by observer after enter)
    assert.ok(events.every((e) => e.inspected === false))
  } finally {
    setOutboundGateObserver(null)
    g.window = prev
  }
})

// --- Ticket 16: main-owned deploy snapshot (Seam B) ---

await test('ticket16: main deploy snapshot required wins over empty/off env', () => {
  const prev = process.env.SUBAGENTS_OUTBOUND_GUARD
  delete process.env.SUBAGENTS_OUTBOUND_GUARD
  try {
    // Without main snapshot, empty env → off (document baseline).
    assert.equal(
      effectiveOutboundGuardFromSettings({ outboundProtectionEnabled: true }),
      'off',
    )
    // Main status says required → settings patch must force effective required
    // even when user toggle is off and renderer env is empty.
    const patch = settingsPatchFromOutboundStatus({ deployGuard: 'required' })
    assert.equal(patch.outboundGuardDeploy, 'required')
    assert.equal(
      effectiveOutboundGuardFromSettings({
        ...patch,
        outboundProtectionEnabled: false,
      }),
      'required',
    )
    // Env cannot weaken a main-owned required snapshot.
    process.env.SUBAGENTS_OUTBOUND_GUARD = 'off'
    assert.equal(
      effectiveOutboundGuardFromSettings({
        ...patch,
        outboundProtectionEnabled: false,
      }),
      'required',
    )
  } finally {
    if (prev === undefined) delete process.env.SUBAGENTS_OUTBOUND_GUARD
    else process.env.SUBAGENTS_OUTBOUND_GUARD = prev
  }
})

await test('ticket16: main invalid deploy fails closed (no silent off patch)', () => {
  assert.throws(
    () => settingsPatchFromOutboundStatus({ deployGuard: 'invalid' }),
    /SUBAGENTS_OUTBOUND_GUARD|invalid/i,
  )
})

await test('ticket16: main optional snapshot respects user toggle only', () => {
  const prev = process.env.SUBAGENTS_OUTBOUND_GUARD
  process.env.SUBAGENTS_OUTBOUND_GUARD = 'required' // env must not override main optional
  try {
    const patch = settingsPatchFromOutboundStatus({ deployGuard: 'optional' })
    assert.equal(
      effectiveOutboundGuardFromSettings({
        ...patch,
        outboundProtectionEnabled: true,
      }),
      'optional',
    )
    assert.equal(
      effectiveOutboundGuardFromSettings({
        ...patch,
        outboundProtectionEnabled: false,
      }),
      'off',
    )
  } finally {
    if (prev === undefined) delete process.env.SUBAGENTS_OUTBOUND_GUARD
    else process.env.SUBAGENTS_OUTBOUND_GUARD = prev
  }
})

await test('ticket16: applyMainOutboundStatus returns effective mode for consumers', () => {
  const prev = process.env.SUBAGENTS_OUTBOUND_GUARD
  delete process.env.SUBAGENTS_OUTBOUND_GUARD
  try {
    const applied = applyMainOutboundStatusToSettings(
      { outboundProtectionEnabled: false },
      { deployGuard: 'required' },
    )
    assert.equal(applied.ok, true)
    if (applied.ok) {
      assert.equal(applied.patch.outboundGuardDeploy, 'required')
      assert.equal(applied.effectiveMode, 'required')
    }
    const inv = applyMainOutboundStatusToSettings(
      { outboundProtectionEnabled: true },
      { deployGuard: 'invalid' },
    )
    assert.equal(inv.ok, false)
  } finally {
    if (prev === undefined) delete process.env.SUBAGENTS_OUTBOUND_GUARD
    else process.env.SUBAGENTS_OUTBOUND_GUARD = prev
  }
})

await test('ticket16: settings load hydrates deploy from main outbound.status', () => {
  const store = fs.readFileSync(path.join(appRoot, 'src/store/settingsStore.ts'), 'utf8')
  assert.match(store, /settingsPatchFromOutboundStatus|applyMainOutboundStatusToSettings/)
  assert.match(store, /outbound\.status|subagents\?\.outbound/)
})

await test('ticket16: Dashboard 出站閘門 uses settings deploy snapshot not renderer env', () => {
  const dash = fs.readFileSync(path.join(appRoot, 'src/pages/DashboardPage.tsx'), 'utf8')
  assert.match(dash, /outboundGuardDeploy/)
  assert.match(dash, /effectiveOutboundGuardFromSettings/)
  // must not treat renderer process.env.SUBAGENTS_OUTBOUND_GUARD as posture source
  assert.doesNotMatch(dash, /SUBAGENTS_OUTBOUND_GUARD/)
})

console.log(`\n${passed} tests passed`)
