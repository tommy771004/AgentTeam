/**
 * High-level outbound run scenario (no Electron window).
 * Simulates: admit protected run → Restricted View → tool root pin →
 * fake LLM payload → CLI path rewrite + sandbox gate → dispose.
 *
 * Run: node --experimental-strip-types scripts/smoke-outbound-run-scenario.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import {
  bindSanitizedViewForRun,
  createSanitizedWorkspace,
  disposeSanitizedWorkspace,
  unbindSanitizedViewForRun,
} from '../src/agent/outbound/sanitizedWorkspace.ts'
import { resolveEffectiveProjectRoot } from '../src/agent/tools/runContext.ts'
import {
  effectiveOutboundGuardFromSettings,
  inspectOutbound,
  isProtectionActive,
  setOutboundGateObserver,
} from '../src/agent/outbound/outboundGate.ts'
import { sanitizeChatMessages } from '../src/agent/outbound/textSanitize.ts'
import {
  evaluateCliSandboxGate,
  rewriteCliPromptForView,
} from '../src/agent/outbound/cliSandbox.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

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

console.log('smoke-outbound-run-scenario')

const SECRET = 'sk-RUN-SCENARIO-SECRET-99'
const profile = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:run-scenario'),
)

await test('protected run path: view pin → tool root → LLM gate clean → dispose', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scen-proj-'))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scen-view-'))
  const runId = 'run_scenario_1'
  const gateHits: Array<{ channel: string; inspected: boolean }> = []
  setOutboundGateObserver((e) => {
    gateHits.push({ channel: e.channel, inspected: e.inspected })
  })

  try {
    fs.mkdirSync(path.join(project, 'src'), { recursive: true })
    fs.writeFileSync(
      path.join(project, 'src', 'secrets.ts'),
      `export const key = 'api_key: ${SECRET}'\nexport const note = 'safe'\n`,
    )
    fs.writeFileSync(
      path.join(project, 'README.md'),
      '# public readme\n',
    )

    const settings = {
      outboundGuardDeploy: 'required' as const,
      outboundProtectionEnabled: false, // ignored under required
    }
    const mode = effectiveOutboundGuardFromSettings(settings)
    assert.equal(mode, 'required')
    assert.equal(isProtectionActive(mode), true)

    // Coordinator-equivalent: create view and pin
    const ws = await createSanitizedWorkspace({
      connectionId: 'llm:run-scenario',
      projectRoot: project,
      profile,
      baseDir: base,
    })
    bindSanitizedViewForRun(runId, ws)

    // Tool path: must resolve to view, not original project
    const toolRoot = await resolveEffectiveProjectRoot(project, runId)
    assert.equal(toolRoot, ws.viewRoot)
    assert.notEqual(toolRoot, project)

    const viewSecretFile = path.join(ws.viewRoot, 'src', 'secrets.ts')
    assert.ok(fs.existsSync(viewSecretFile))
    const viewBody = fs.readFileSync(viewSecretFile, 'utf8')
    assert.doesNotMatch(viewBody, new RegExp(SECRET))
    assert.match(
      viewBody,
      new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
    // original intact
    assert.match(fs.readFileSync(path.join(project, 'src', 'secrets.ts'), 'utf8'), new RegExp(SECRET))

    // Fake multi-round LLM: each transport crosses gate; payload clean
    const userPrompt = `Please review:\n${viewBody}\nAlso see README.`
    for (let round = 0; round < 2; round++) {
      const sanitized = sanitizeChatMessages(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: userPrompt },
        ],
        profile,
      )
      const gate = inspectOutbound({
        channel: 'llm',
        runId,
        payload: {
          model: 'fake-model',
          messages: sanitized.messages,
          round,
        },
        effectiveMode: mode,
        buildFlavor: 'standard',
        providerConnectionId: 'llm:run-scenario',
      })
      assert.equal(gate.action, 'allow')
      if (gate.action === 'allow') {
        assert.equal(gate.inspected, true)
        const json = JSON.stringify(gate.payload)
        assert.ok(!json.includes(SECRET), `round ${round} leaked secret`)
      }
    }
    assert.equal(gateHits.filter((h) => h.channel === 'llm').length, 2)

    // CLI path rewrite + required sandbox policy
    const cliPrompt = `edit ${project}/src/secrets.ts carefully`
    const rewritten = rewriteCliPromptForView(cliPrompt, {
      originalRoot: project,
      viewRoot: ws.viewRoot,
    })
    assert.doesNotMatch(rewritten, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(rewritten, new RegExp(ws.viewRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    // Without verified sandbox, required must deny CLI
    const denyCli = evaluateCliSandboxGate({
      effectiveMode: 'required',
      isolationStatus: 'unavailable',
    })
    assert.equal(denyCli.allow, false)

    // With verified status, CLI allowed (process wrap is separate)
    const allowCli = evaluateCliSandboxGate({
      effectiveMode: 'required',
      isolationStatus: 'verified',
    })
    assert.equal(allowCli.allow, true)
    const cliGate = inspectOutbound({
      channel: 'cli',
      runId,
      payload: { prompt: rewritten, cwd: ws.viewRoot },
      effectiveMode: mode,
      buildFlavor: 'standard',
    })
    assert.equal(cliGate.action, 'allow')

    unbindSanitizedViewForRun(runId)
    await disposeSanitizedWorkspace(ws)
    assert.ok(!fs.existsSync(ws.viewRoot))
    // After unbind, explicit root wins again
    const after = await resolveEffectiveProjectRoot(project, runId)
    assert.equal(after, project)
  } finally {
    setOutboundGateObserver(null)
    unbindSanitizedViewForRun(runId)
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

await test('optional protection off → effective off bypasses inspection', () => {
  const mode = effectiveOutboundGuardFromSettings({
    outboundGuardDeploy: 'optional',
    outboundProtectionEnabled: false,
  })
  assert.equal(mode, 'off')
  const r = inspectOutbound({
    channel: 'llm',
    payload: { messages: [{ role: 'user', content: `api_key: ${SECRET}` }] },
    effectiveMode: mode,
    buildFlavor: 'policy-admin', // flavor never bypasses when active; off still bypasses
  })
  assert.equal(r.action, 'allow')
  if (r.action === 'allow') {
    assert.equal(r.inspected, false)
    // off does not sanitize — secret still in payload (document intentional)
    assert.ok(JSON.stringify(r.payload).includes(SECRET))
  }
})

console.log(`\n${passed} tests passed`)
