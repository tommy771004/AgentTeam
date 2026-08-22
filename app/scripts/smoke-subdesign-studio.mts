/**
 * SubDesign Studio integration contracts (ticket 05 automated slice).
 * Seam: deriveSubDesignWorkspace + static page/component wiring.
 * Manual Playwright Chromium path is optional when browser is available.
 * Run: node --experimental-strip-types scripts/smoke-subdesign-studio.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveSubDesignWorkspace } from '../src/agent/subdesign/workspace.ts'
import { critiqueAllowsDeliver } from '../src/agent/subdesign/critique.ts'
import { parseOpenDesignInventory } from '../src/agent/openDesign/catalog.ts'
import {
  getOpenDesignExploreTemplates,
  openDesignRecordToTemplate,
} from '../src/agent/subdesign/templateCatalog.ts'
import type { SubDesignBrief } from '../src/agent/subdesign/types.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
async function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-subdesign-studio')

function brief(partial: Partial<SubDesignBrief> & Pick<SubDesignBrief, 'id' | 'stage'>): SubDesignBrief {
  const directions = partial.directions || [
    { id: 'd1', title: 'Bold', summary: 'High contrast marketing' },
  ]
  return {
    id: partial.id,
    threadId: partial.threadId || 'th_1',
    objective: partial.objective || 'Design a landing page',
    stage: partial.stage,
    surface: partial.surface || 'prototype',
    platform: partial.platform || 'responsive',
    constraints: partial.constraints || [],
    acceptanceCriteria: partial.acceptanceCriteria || [],
    selectedDirectionId: partial.selectedDirectionId,
    designSystemId: partial.designSystemId,
    createdAt: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-01-01T00:00:00.000Z',
    ...partial,
    directions: partial.directions || directions,
  }
}

await test('workspace: five stages with current + next gate', () => {
  const vm = deriveSubDesignWorkspace({
    brief: brief({ id: 'b1', stage: 'build', selectedDirectionId: 'd1' }),
    runStatus: 'running',
  })
  assert.equal(vm.stages.length, 5)
  assert.equal(vm.currentStage, 'build')
  assert.ok(vm.stages.some((s) => s.state === 'active' && s.id === 'build'))
  assert.ok(vm.nextGate)
  assert.equal(vm.runStatus, 'active')
})

await test('workspace: deliver locked until critique pass', () => {
  const locked = deriveSubDesignWorkspace({
    brief: brief({ id: 'b2', stage: 'critique', selectedDirectionId: 'd1' }),
    artifacts: [
      {
        id: 'a1',
        briefId: 'b2',
        title: 'v1',
        kind: 'html',
        revision: 1,
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never,
    ],
    critique: { verdict: 'needs-revision' } as never,
  })
  const deliver = locked.stages.find((s) => s.id === 'deliver')
  assert.ok(deliver)
  assert.equal(deliver!.state, 'locked')

  const open = deriveSubDesignWorkspace({
    brief: brief({ id: 'b3', stage: 'deliver', selectedDirectionId: 'd1' }),
    critique: { verdict: 'pass' } as never,
  })
  const deliverOpen = open.stages.find((s) => s.id === 'deliver')
  assert.ok(deliverOpen)
  assert.notEqual(deliverOpen!.state, 'locked')
})

await test('critiqueAllowsDeliver gates delivery', () => {
  const evidence = [
    { kind: 'screenshot', path: 'a.png' },
    { kind: 'dom', path: 'a.html' },
    { kind: 'lint', path: 'a.lint' },
  ]
  assert.equal(
    critiqueAllowsDeliver({
      verdict: 'pass',
      evidence,
      findings: [],
    } as never),
    true,
  )
  assert.equal(
    critiqueAllowsDeliver({
      verdict: 'needs-revision',
      evidence,
      findings: [],
    } as never),
    false,
  )
  assert.equal(
    critiqueAllowsDeliver({
      verdict: 'pass',
      evidence: [],
      findings: [],
    } as never),
    false,
  )
})

await test('route + Variant A studio wiring (static)', () => {
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  assert.match(app, /subdesign\/:briefId/)
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspace.ts'), 'utf8')
  const integration = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspaceIntegration.ts'), 'utf8')
  assert.match(page, /SubDesignProjectStudio/)
  assert.match(page, /SubDesignRunInspector|runIsLive|onStartRun/)
  assert.match(workspace, /runTask\(/)
  assert.match(integration, /runTask/)
  assert.doesNotMatch(page, /dispatchThreadTask|startExecution/)
  assert.match(page, /modelDiscoveryWarning/)
  assert.match(page, /模型發現失敗/)
  assert.match(page, /workspaceHydrationError/)
  // prototype only under DEV + query flag
  assert.match(page, /import\.meta\.env\.DEV/)
  assert.match(page, /prototype.*subdesign-flow|subdesign-flow/)
  assert.match(page, /SubDesignFlowPrototype/)
})

await test('workspace presentation seam owns workflow readings', () => {
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspace.ts'), 'utf8')
  const integration = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspaceIntegration.ts'), 'utf8')
  assert.match(page, /workspaceProjection\.presentation/)
  assert.match(page, /workspaceProjection\.workspacesByBriefId/)
  assert.match(workspace, /readPresentation|subscribePresentation/)
  assert.match(integration, /subscribePresentation|readPresentation/)
  assert.doesNotMatch(page, /use(?:Agent|Learning|Project|SubDesign|Thread|RunActivity|OpenDesignPack|Settings)Store/)
})

await test('OpenDesign explore collection is ordered by the inventory, not a second list', () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'public/open-design/OPEN_DESIGN_INVENTORY.json'), 'utf8'),
  )
  const catalog = parseOpenDesignInventory(inventory)
  const templates = catalog.records
    .filter((record) => record.kind === 'template')
    .map(openDesignRecordToTemplate)
  const explore = getOpenDesignExploreTemplates(templates)

  // ADR-0001: the inventory is the single source of truth for what content is
  // available. The renderer must not keep its own copy of the collection.
  const catalogSrc = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/templateCatalog.ts'), 'utf8')
  assert.doesNotMatch(catalogSrc, /OPEN_DESIGN_EXPLORE_TEMPLATE_IDS/)
  assert.match(catalogSrc, /exploreRank/)

  assert.ok(explore.length > 0)
  // Ordered by the rank the indexer assigned, contiguous from 0, no duplicates.
  const ranks = explore.map((template) => template.exploreRank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)))
  assert.deepEqual(ranks, ranks.map((_, index) => index))
  assert.equal(new Set(explore.map((template) => template.id)).size, explore.length)

  assert.ok(explore.every((template) => template.availability === 'ready'))
  assert.ok(explore.every((template) => template.surface))
  assert.ok(explore.every((template) => !template.contractNotice))

  const records = new Map(catalog.records.map((record) => [record.id, record]))
  for (const template of explore) {
    const record = records.get(template.id)
    assert.ok(record, `missing official explore record: ${template.id}`)
    assert.match(record.upstreamCommit, /^b032abed00ab/)
    assert.ok(record.digest.length >= 64)
    assert.ok(record.licensePaths.length > 0)
  }
})

await test('SubDesign picker exposes official explore and full catalog views', () => {
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.match(page, /探索全部資源/)
  assert.match(page, /getOpenDesignExploreTemplates/)
  assert.match(page, /setTemplateCollection/)
  assert.match(page, /官方精選/)
  assert.match(page, /本機全部/)
})

await test('studio components: nav, inspector, delivery lock surface', () => {
  const studio = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'),
    'utf8',
  )
  assert.match(studio, /ArtifactDeliveryPanel/)
  assert.match(studio, /critiquePassed/)
  assert.match(studio, /SubDesignRunInspector|tab/)
  const delivery = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/ArtifactDeliveryPanel.tsx'),
    'utf8',
  )
  assert.match(delivery, /critiquePassed/)
  const nav = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignStudioNav.tsx'),
    'utf8',
  )
  assert.match(nav, /export function SubDesignStudioNav/)
})

await test('conversation lifecycle keeps steer/queue, reply, and Stop available', () => {
  const conversation = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignConversationPane.tsx'),
    'utf8',
  )
  assert.match(conversation, /const canSubmit = Boolean\(draft\.trim\(\)\) && !submitting/)
  assert.match(conversation, /disabled=\{submitting\}/)
  assert.match(conversation, /runIsLive \? \(/)
  assert.match(conversation, /onClick=\{onStopRun\}/)
  assert.match(conversation, /輸入可轉向或排隊的後續指令/)
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.doesNotMatch(page, /if \(runIsLive && !awaitingUser\) return/)
})

await test('visual QA fixture controls have real state transitions', () => {
  const fixture = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignUnified.fixture.tsx'),
    'utf8',
  )
  assert.match(fixture, /setRunIsLive\(true\)/)
  assert.match(fixture, /setRunIsLive\(false\)/)
  assert.match(fixture, /setSelectedArtifact/)
  assert.match(fixture, /setFixtureBrief/)
  assert.match(fixture, /setFixtureThread/)
})

await test('responsive discoverability classes on studio shell', () => {
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  // list / studio shells keep md/lg breakpoints
  assert.match(page, /md:|lg:|max-w-\[/)
  const studio = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'),
    'utf8',
  )
  assert.match(studio, /md:|lg:|sm:|min-w-0|overflow/)
})

await test('prototype file is clearly non-production', () => {
  const proto = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignFlow.prototype.tsx'),
    'utf8',
  )
  assert.match(proto, /PROTOTYPE|prototype/i)
  assert.match(proto, /subdesign-flow/)
})

console.log(`\n${passed} tests passed`)
