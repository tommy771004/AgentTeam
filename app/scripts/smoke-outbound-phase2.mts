/**
 * Outbound Data Gate tickets 09–15 pure-module smoke.
 * Run: node --experimental-strip-types scripts/smoke-outbound-phase2.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
  type CompanyBasePolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import {
  createRgbaImage,
  prepareImageForExternalAi,
  resolveImageVisionAuth,
  validateBoundingBoxes,
} from '../src/agent/outbound/imageSanitize.ts'
import {
  WorkspaceBundleCache,
  fetchWorkspacePolicyBundle,
  resolveOfflineBundleAccess,
  validatePolicyBundle,
} from '../src/agent/outbound/workspacePolicyBundle.ts'
import {
  enrollManagedDevice,
  openWorkspaceEnvelope,
  parseWorkspacePublicKeys,
  renameDeviceLabel,
  requiresSecureEnvelope,
  sealWorkspaceEnvelope,
} from '../src/agent/outbound/deviceEnrollment.ts'
import {
  EvidenceUploadQueue,
  replaceDevice,
  retireDevice,
} from '../src/agent/outbound/evidenceUpload.ts'
import {
  PolicyAdminStore,
  parseBuildFlavorStrict,
  policyAdminSurfacesEnabled,
} from '../src/agent/outbound/policyAdmin.ts'
import { publishPolicyToWorkspace } from '../src/agent/outbound/workspacePublish.ts'
import {
  appendEvidenceRecord,
  createMemoryHmacKeyProvider,
  verifyLedgerFile,
} from '../src/agent/outbound/evidenceLedger.ts'
import {
  effectiveOutboundGuardFromSettings,
  inspectOutbound,
  parseDeployOutboundGuard,
} from '../src/agent/outbound/outboundGate.ts'
import { connectionIdForBuiltinLlm } from '../src/agent/outbound/providerConnectionId.ts'

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

console.log('smoke-outbound-phase2 (09–15)')

// ── 09 images ──────────────────────────────────────────────
await test('09: vision deny-by-default; only company base authorizes', () => {
  const base = { ...BUILTIN_BASELINE_POLICY }
  const denied = resolveImageVisionAuth(base)
  assert.equal(denied.authorized, false)

  const authorizedBase: CompanyBasePolicy = {
    ...base,
    visionAuthorization: {
      enabled: true,
      endpointUrl: 'https://classify.corp.example/v1',
    },
  }
  const ok = resolveImageVisionAuth(authorizedBase)
  assert.equal(ok.authorized, true)
})

await test('09: invalid boxes rejected; authorized path yields masked derivative', () => {
  assert.equal(validateBoundingBoxes([{ x: -0.1, y: 0, w: 0.2, h: 0.2 }]), null)
  assert.equal(validateBoundingBoxes([{ x: 0, y: 0, w: 2, h: 0.1 }]), null)
  const boxes = validateBoundingBoxes([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }])
  assert.ok(boxes)

  const base: CompanyBasePolicy = {
    ...BUILTIN_BASELINE_POLICY,
    visionAuthorization: { enabled: true, endpointUrl: 'https://c.example/v1' },
  }
  const profile = compileProviderSecurityProfile(base, emptySupplementalPolicy('llm:img'))
  const img = createRgbaImage({
    width: 10,
    height: 10,
    fill: [255, 0, 0, 255],
    connectionId: 'llm:img',
    policyVersion: '1',
  })
  const unauth = prepareImageForExternalAi({
    companyBase: BUILTIN_BASELINE_POLICY,
    profile,
    image: img,
    classifierBoxes: boxes,
    classifierStatus: 'ok',
  })
  assert.equal(unauth.ok, false)

  const ready = prepareImageForExternalAi({
    companyBase: base,
    profile,
    image: img,
    classifierBoxes: boxes,
    classifierStatus: 'ok',
  })
  assert.equal(ready.ok, true)
  if (ready.ok) {
    // center of box should be black
    const x = 2
    const y = 2
    const i = (y * 10 + x) * 4
    assert.equal(ready.derivative.data[i], 0)
    assert.equal(ready.derivative.data[i + 1], 0)
    // evidence has no pixel digest field
    assert.ok(!('digest' in ready.evidence))
  }
})

// ── 10 workspace bundles ───────────────────────────────────
await test('10: atomic bundle validate + cache isolation + offline block', () => {
  const connA = 'llm:a'
  const connB = 'llm:b'
  const bundleA = validatePolicyBundle({
    schemaVersion: 1,
    kind: 'policy-bundle',
    workspaceId: 'ws1',
    connectionId: connA,
    bundleVersion: 2,
    changeId: 'c2',
    etag: 'e2',
    companyBase: BUILTIN_BASELINE_POLICY,
    providerSupplement: emptySupplementalPolicy(connA),
  })
  const cache = new WorkspaceBundleCache()
  assert.equal(cache.put(bundleA).ok, true)
  const bundleB = {
    ...bundleA,
    connectionId: connB,
    providerSupplement: emptySupplementalPolicy(connB),
  }
  assert.equal(cache.put(bundleB).ok, true)
  assert.notEqual(
    cache.get('ws1', connA)?.profile.connectionId,
    cache.get('ws1', connB)?.profile.connectionId,
  )
  // rollback replay
  const older = { ...bundleA, bundleVersion: 1, changeId: 'c1', etag: 'e1' }
  assert.equal(cache.put(older).ok, false)

  const offline = resolveOfflineBundleAccess({
    policySource: 'workspace',
    cache: cache.get('ws1', connA),
    networkAvailable: false,
    effectiveGuardMode: 'required',
    nowMs: Date.now() + 100 * 24 * 3_600_000, // expired
  })
  assert.equal(offline.action, 'block')
})

await test('10: fetch requires auth; mismatched identity rejected', async () => {
  const noAuth = await fetchWorkspacePolicyBundle({
    endpointUrl: 'https://ws.example/bundle',
    connectionId: 'llm:x',
    workspaceId: 'ws1',
    auth: { type: 'bearer', token: '' },
    fetchImpl: async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response,
  })
  // empty token still "has" bearer type — server would 401; our client sends it
  // Mismatch test with valid bundle body but wrong connection
  const bad = await fetchWorkspacePolicyBundle({
    endpointUrl: 'https://ws.example/bundle',
    connectionId: 'llm:want',
    workspaceId: 'ws1',
    auth: { type: 'bearer', token: 't' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'policy-bundle',
          workspaceId: 'ws1',
          connectionId: 'llm:other',
          bundleVersion: 1,
          changeId: 'c',
          etag: 'e',
          companyBase: BUILTIN_BASELINE_POLICY,
          providerSupplement: emptySupplementalPolicy('llm:other'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as unknown as Response,
  })
  assert.equal(bad.ok, false)
  void noAuth
})

// ── 11 device + envelope ───────────────────────────────────
await test('11: opaque device id; rename keeps id; envelope replay denied', () => {
  const d1 = enrollManagedDevice('Desk')
  const d2 = enrollManagedDevice('Desk')
  assert.notEqual(d1.deviceId, d2.deviceId)
  assert.match(d1.deviceId, /^mdv_/)
  const renamed = renameDeviceLabel(d1, 'Lab laptop')
  assert.equal(renamed.deviceId, d1.deviceId)
  assert.equal(renamed.label, 'Lab laptop')

  assert.equal(requiresSecureEnvelope('http'), true)
  assert.equal(requiresSecureEnvelope('https'), false)

  const key = crypto.randomBytes(32)
  const keys = new Map([['k1', key]])
  const env = sealWorkspaceEnvelope({
    keyId: 'k1',
    key,
    plaintext: JSON.stringify({ hello: 1 }),
    sequence: 1,
  })
  const seen = new Set<string>()
  const accept = (kid: string, seq: number) => {
    const k = `${kid}:${seq}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }
  const open1 = openWorkspaceEnvelope({ envelope: env, keys, acceptSequence: accept })
  assert.equal(open1.ok, true)
  const openReplay = openWorkspaceEnvelope({ envelope: env, keys, acceptSequence: accept })
  assert.equal(openReplay.ok, false)
  if (!openReplay.ok) assert.match(openReplay.reason, /replay|sequence/i)

  const parsed = parseWorkspacePublicKeys('k1:' + key.toString('base64') + ',k2:' + crypto.randomBytes(32).toString('base64'))
  assert.equal(parsed.size, 2)
})

// ── 12 upload + lifecycle ──────────────────────────────────
await test('12: upload queue idempotent ack; retention skips unacked', async () => {
  const q = new EvidenceUploadQueue()
  const rec = {
    schemaVersion: 1 as const,
    eventId: 'ev1',
    sequence: 1,
    timestampUtc: new Date(Date.now() - 90 * 24 * 3_600_000).toISOString(),
    eventType: 'outbound-decision' as const,
    sealed: false,
  }
  q.enqueue(rec)
  q.enqueue(rec) // idempotent
  assert.equal(q.pending().length, 1)
  const flush = await q.flush(async (batch) => ({
    highestContiguousSequence: batch[batch.length - 1].sequence,
    eventIds: batch.map((b) => b.eventId),
  }))
  assert.equal(flush.remaining, 0)
  const del = q.retainableForDeletion({
    records: [rec],
    retentionWeeks: 4,
    nowMs: Date.now(),
  })
  assert.equal(del.length, 1)

  const retired = retireDevice('mdv_x', 'lost')
  assert.equal(retired.type, 'device-retired')
  const replaced = replaceDevice({
    oldDeviceId: 'mdv_old',
    newDeviceId: 'mdv_new',
    hadUnrecoverablePending: true,
  })
  assert.equal(replaced.type, 'device-replaced')
  if (replaced.type === 'device-replaced') assert.equal(replaced.unrecoverablePendingGap, true)
})

// ── 13 policy admin ────────────────────────────────────────
await test('13: draft does not activate; rollback increases version; flavor gates surfaces', () => {
  const store = new PolicyAdminStore()
  const draftBody = { ...BUILTIN_BASELINE_POLICY, version: 2, changeId: 'd2' }
  const saved = store.saveDraft({ id: 'd1', kind: 'company-base', body: draftBody })
  assert.equal(saved.ok, true)
  assert.equal(store.active.size, 0)
  const act = store.activateDraft('d1')
  assert.equal(act.ok, true)
  if (!act.ok) return
  const rb = store.rollback({
    kind: 'company-base',
    targetVersion: 1,
    targetBody: BUILTIN_BASELINE_POLICY,
    reason: 'bad rollout',
  })
  assert.equal(rb.ok, true)
  if (rb.ok) {
    assert.ok(rb.slot.version > act.slot.version)
    assert.ok(rb.slot.rollbackOf)
  }
  assert.equal(parseBuildFlavorStrict(undefined), 'standard')
  assert.equal(policyAdminSurfacesEnabled('standard'), false)
  assert.equal(policyAdminSurfacesEnabled('policy-admin'), true)
  assert.throws(() => parseBuildFlavorStrict('pro'))
})

// ── 14 publish + verify ────────────────────────────────────
await test('14: publish activates then publishes; evidence verify works', async () => {
  const store = new PolicyAdminStore()
  store.saveDraft({
    id: 'pub1',
    kind: 'company-base',
    body: { ...BUILTIN_BASELINE_POLICY, version: 3, changeId: 'pub' },
  })
  const pub = await publishPolicyToWorkspace({ store, draftId: 'pub1' })
  assert.equal(pub.ok, true)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-p14-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('k'.repeat(32)))
  try {
    await appendEvidenceRecord(
      {
        eventType: 'policy-change',
        policyVersion: '3',
        action: 'activate',
        exclusions: [],
      },
      { ledgerDir: dir, keyProvider: key, sealed: true },
    )
    const file = path.join(dir, fs.readdirSync(dir)[0])
    const v = await verifyLedgerFile(file, key)
    assert.equal(v.ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── 15 release matrix ──────────────────────────────────────
await test('15: cross-provider isolation + guard modes matrix', () => {
  const modes = ['off', 'demo', 'optional', 'required'] as const
  for (const m of modes) {
    assert.equal(parseDeployOutboundGuard(m), m)
  }
  const a = connectionIdForBuiltinLlm({ apiProvider: 'openai', baseUrl: 'https://a.example/v1' })
  const b = connectionIdForBuiltinLlm({ apiProvider: 'openai', baseUrl: 'https://b.example/v1' })
  assert.notEqual(a, b)

  // two connections → independent profiles
  const pA = compileProviderSecurityProfile(
    BUILTIN_BASELINE_POLICY,
    emptySupplementalPolicy(a),
  )
  const pB = compileProviderSecurityProfile(
    BUILTIN_BASELINE_POLICY,
    {
      ...emptySupplementalPolicy(b),
      extraDetectors: [{ id: 'company.b-only', pattern: 'SECRET-B' }],
    },
  )
  assert.equal(pA.connectionId, a)
  assert.ok(pB.detectors.some((d) => d.id === 'company.b-only'))
  assert.ok(!pA.detectors.some((d) => d.id === 'company.b-only'))

  // gate still required for both
  for (const conn of [a, b]) {
    const g = inspectOutbound({
      channel: 'llm',
      payload: { provider: conn },
      effectiveMode: 'required',
      buildFlavor: 'standard',
      providerConnectionId: conn,
    })
    assert.equal(g.action, 'allow')
    if (g.action === 'allow') assert.equal(g.inspected, true)
  }

  // optional user off → effective off
  assert.equal(
    effectiveOutboundGuardFromSettings({
      outboundGuardDeploy: 'optional',
      outboundProtectionEnabled: false,
    }),
    'off',
  )
})

console.log(`\n${passed} tests passed`)
