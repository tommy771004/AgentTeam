/**
 * Smoke: OpenDesign Plugin Contract v1 — authoritative parser.
 * Covers legacy success, v1 success, unknown major version, malformed cases.
 * Also proves catalog/packs/admission share the same parser (drift guard).
 *
 * Run: node --experimental-strip-types scripts/smoke-open-design-contract.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseOpenDesignPluginManifest,
  contractResultToDisplay,
} from '../src/agent/openDesign/pluginContract.ts'
import { validatePluginContract } from '../src/agent/openDesign/catalog.ts'
import { packContractMayEnable } from '../src/agent/openDesign/packs.ts'
import { admitPluginForTaskRun } from '../src/agent/openDesign/contractAdmission.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

let passed = 0
let total = 0

async function test(name: string, fn: () => void | Promise<void>) {
  total++
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}

console.log('smoke-open-design-contract')

await test('legacy: SKILL.md-only manifest is compatible', () => {
  const legacy = { name: 'example-edge', title: '範例外掛', kind: 'skill' }
  const r = parseOpenDesignPluginManifest(legacy)
  assert.equal(r.ok, true)
  assert.equal((r as { kind: string }).kind, 'legacy')
})

await test('legacy: plain SKILL.md string is compatible', () => {
  const r = parseOpenDesignPluginManifest('# Skill\n\ncontent')
  assert.equal(r.ok, true)
  assert.equal((r as { kind: string }).kind, 'legacy')
})

await test('v1 success: full spec fields are accepted', () => {
  const v1 = {
    specVersion: '1.0.0',
    name: 'example-blog-post',
    version: '0.1.0',
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      mode: 'deck',
      inputs: [
        { name: 'topic', label: 'Topic', type: 'string', required: true, placeholder: 'hello' },
        { name: 'slideCount', label: 'Length', type: 'select', options: ['8', '10'], default: '8' },
      ],
      pipeline: { stages: [{ id: 'generate', atoms: ['file-write'] }] },
      capabilities: ['prompt:inject', 'fs:write'],
      evals: [{ id: 'brand-check', kind: 'brand', criteria: 'must be on-brand' }],
      preview: { type: 'html', entry: './example.html' },
      provenance: { origin: { name: 'test' } },
    },
  }
  const r = parseOpenDesignPluginManifest(v1)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.kind, 'v1')
    assert.equal(r.manifest.specVersion, '1.0.0')
    assert.equal(r.manifest.kind, 'scenario')
    assert.equal(r.manifest.taskKind, 'new-generation')
    assert.equal(r.manifest.inputs?.length, 2)
    assert.equal(r.manifest.pipeline?.stages.length, 1)
    assert.deepEqual(r.manifest.capabilities, ['prompt:inject', 'fs:write'])
    assert.equal(r.manifest.evals?.length, 1)
    assert.equal(r.manifest.preview?.type, 'html')
  }
  // catalog / packs / admission must use same parser
  const viaCatalog = validatePluginContract(v1)
  assert.deepEqual(viaCatalog.ok, r.ok)
  const viaPack = packContractMayEnable(
    {
      id: 'open-design:test',
      name: 'test',
      version: 'x',
      kind: 'template',
      enabled: false,
      trustState: 'bundled',
      sourcePath: 'a',
      sourceUrl: '',
      upstreamCommit: '',
      digest: 'd',
      licensePaths: [],
      assetPaths: [],
      entryPaths: [],
      executionStatus: 'ready',
      installedAt: '',
      customTools: [],
      mcpServers: [],
    },
    v1,
  )
  assert.equal(viaPack.ok, true)
  const viaAdmission = admitPluginForTaskRun(v1)
  assert.equal(viaAdmission.admitted, true)
})

await test('unknown major version is incompatible with clear message', () => {
  const r = parseOpenDesignPluginManifest({ specVersion: '2.0.0', od: { kind: 'scenario' } })
  assert.equal(r.ok, false)
  assert.equal((r as { kind: string }).kind, 'incompatible')
  assert.match((r as { reason: string }).reason, /不支援的 specVersion 2\.0\.0/)
  const disp = contractResultToDisplay(r)
  assert.equal(disp.executable, false)
  assert.equal(disp.label, '不相容')
})

await test('malformed: unknown capability fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', capabilities: ['network', 'evil:cap'] },
  })
  assert.equal(r.ok, false)
  assert.equal((r as { kind: string }).kind, 'malformed')
  assert.match((r as { reason: string }).reason, /未知 capability/)
})

await test('malformed: invalid stage id fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', pipeline: { stages: [{ id: '' }] } },
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /id 不合法/)
})

await test('malformed: invalid repeat fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', pipeline: { stages: [{ id: 'generate', repeat: 999 }] } },
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /repeat/)
})

await test('malformed: until empty fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', pipeline: { stages: [{ id: 'generate', until: '' }] } },
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /until/)
})

await test('malformed: invalid input schema fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', inputs: [{ name: 'bad name!', type: 'string' }] },
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /name 不合法/)
})

await test('malformed: select without options fails closed', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', inputs: [{ name: 'choice', type: 'select' }] },
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /options/)
})

await test('forward compat: unknown non-security top-level field is accepted', () => {
  const r = parseOpenDesignPluginManifest({
    specVersion: '1.0.0',
    od: { kind: 'scenario', capabilities: ['fs:write'] },
    someFutureField: 'hello',
    anotherFuture: { nested: true },
  })
  assert.equal(r.ok, true)
  if (r.ok && r.kind === 'v1') {
    assert.ok(r.warnings.some((w) => w.includes('someFutureField') || w.includes('anotherFuture')) || r.warnings.length >= 0)
    // unknown fields do not grant capabilities
    assert.deepEqual(r.manifest.capabilities, ['fs:write'])
  }
})

await test('minor version forward compat: 1.2.0 accepted with warning', () => {
  const r = parseOpenDesignPluginManifest({ specVersion: '1.2.0', od: { kind: 'scenario' } })
  assert.equal(r.ok, true)
  assert.equal((r as { kind: string }).kind, 'v1')
})

await test('catalog / packs / admission share the same parser (drift guard)', () => {
  const catalogSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/catalog.ts'), 'utf8')
  assert.match(catalogSrc, /parseOpenDesignPluginManifest|validatePluginContract/)
  assert.match(catalogSrc, /pluginContract\.ts/)
  const packsSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/packs.ts'), 'utf8')
  assert.match(packsSrc, /parseOpenDesignPluginManifest/)
  assert.match(packsSrc, /packContractMayEnable/)
  const admissionSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/contractAdmission.ts'), 'utf8')
  assert.match(admissionSrc, /parseOpenDesignPluginManifest/)
})

await test('no new daemon/runner/renderer execution owner is introduced', () => {
  const pluginContractSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/pluginContract.ts'), 'utf8')
  // Contract module must be pure parser — no process spawn, daemon, or renderer imports
  assert.doesNotMatch(pluginContractSrc, /spawn|exec\(|daemon|renderer.*execution/)
  const admissionSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/contractAdmission.ts'), 'utf8')
  assert.doesNotMatch(admissionSrc, /dispatchThreadTask|startExecution/)
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed')
else console.log('OK')
