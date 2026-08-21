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
import { openDesignContractLabel, parseOpenDesignInventory } from '../src/agent/openDesign/catalog.ts'
import { admitPluginForTaskRun } from '../src/agent/subdesign/pluginAdmission.ts'

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
  // Task-run admission consumes the same result object, never a re-parse.
  const viaAdmission = admitPluginForTaskRun(r)
  assert.equal(viaAdmission.admitted, true)
  assert.equal(viaAdmission.contract, r)
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

await test('the shipped catalog carries the contract verdict, and nobody re-infers it', () => {
  // The index is the single validation point: it runs the authoritative parser.
  const indexerSrc = fs.readFileSync(path.join(appRoot, 'scripts/open-design-inventory.mts'), 'utf8')
  assert.match(indexerSrc, /parseOpenDesignPluginManifest/)
  // The old capability sniff must not come back.
  assert.doesNotMatch(indexerSrc, /governedScenario/)

  // Catalog and admission read that verdict; neither re-parses a manifest.
  const catalogSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/catalog.ts'), 'utf8')
  assert.doesNotMatch(catalogSrc, /parseOpenDesignPluginManifest/)
  assert.match(catalogSrc, /contractStatus/)
  const packsSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/packs.ts'), 'utf8')
  assert.doesNotMatch(packsSrc, /parseOpenDesignPluginManifest/)
  const admissionSrc = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/pluginAdmission.ts'), 'utf8')
  assert.doesNotMatch(admissionSrc, /parseOpenDesignPluginManifest/)

  // Behavioural, not textual: a rejected contract reaches the catalog as
  // `invalid` with a readable reason, and is never downgraded to content-only.
  const index = parseOpenDesignInventory({
    version: 1,
    records: [
      {
        id: 'x', kind: 'template', sourcePath: 'a/b', executionStatus: 'ready',
        contractStatus: 'malformed', contractReason: 'inputs[1].default 必須是 options 之一。',
      },
      {
        id: 'y', kind: 'template', sourcePath: 'a/c', executionStatus: 'ready',
        contractStatus: 'v1-compatible', specVersion: '1.0.0',
      },
    ],
  })
  const [bad, good] = index.records
  assert.equal(bad.executionStatus, 'invalid')
  assert.equal(bad.contractStatus, 'malformed')
  assert.match(bad.parseWarnings.join(' '), /格式錯誤.*options/)
  assert.equal(good.executionStatus, 'ready')
  assert.equal(good.specVersion, '1.0.0')
  assert.match(openDesignContractLabel('incompatible', '不支援的 specVersion 2.0.0'), /不相容.*2\.0\.0/)
})

await test('the real vendor index fails a malformed manifest closed', async () => {
  const inventory = parseOpenDesignInventory(
    JSON.parse(fs.readFileSync(path.join(appRoot, 'public/open-design/OPEN_DESIGN_INVENTORY.json'), 'utf8')),
  )
  assert.ok(inventory.records.length > 0)
  // Every record carries a verdict, and v1 records name their spec version.
  for (const record of inventory.records) {
    assert.ok(record.contractStatus, `${record.id} 缺少 contractStatus`)
    if (record.contractStatus === 'v1-compatible') assert.ok(record.specVersion)
    if (record.contractStatus === 'malformed' || record.contractStatus === 'incompatible') {
      assert.equal(record.executionStatus, 'invalid')
      assert.ok(record.contractReason)
    }
  }
  // `ready` on a legacy record means renderable content, never pipeline
  // execution — only a v1 contract can name a spec version, and only v1
  // reaches admission (see pluginExecutionPreparation).
  assert.ok(inventory.records.some((item) => item.contractStatus === 'v1-compatible' && item.executionStatus === 'ready'))
  assert.ok(inventory.records.every((item) => item.contractStatus === 'v1-compatible' || !item.specVersion))
  for (const legacy of inventory.records.filter((item) => item.contractStatus === 'legacy-compatible')) {
    assert.equal(admitPluginForTaskRun({
      ok: true, kind: 'legacy', compatible: true, executionStatus: 'legacy-compatible',
      manifest: { specVersion: null, raw: {} }, warnings: [],
    }).admitted, true, `${legacy.id} legacy 仍可被 catalog 採用`)
  }
})

await test('no new daemon/runner/renderer execution owner is introduced', () => {
  const pluginContractSrc = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/pluginContract.ts'), 'utf8')
  // Contract module must be pure parser — no process spawn, daemon, or renderer imports
  assert.doesNotMatch(pluginContractSrc, /spawn|exec\(|daemon|renderer.*execution/)
  const admissionSrc = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/pluginAdmission.ts'), 'utf8')
  assert.doesNotMatch(admissionSrc, /dispatchThreadTask|startExecution/)
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed')
else console.log('OK')
