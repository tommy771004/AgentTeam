import assert from 'node:assert/strict'

/**
 * Skills auto-load through the Host directory only (ADR-0034). The one-shot
 * boot migration seeds it ONCE — everything a user does afterwards（技能庫
 * 儲存／釘選／刪除、學習草稿核准）must reach the same bridge, or the skill
 * silently never loads. This smoke drives the SHIPPED push path against a
 * fake bridge and asserts the full list travels with mapped statuses.
 */

let passed = 0
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); passed++; console.log(`  ✓ ${name}`) })()
}
import { readFileSync } from 'node:fs'
const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

// A minimal browser-ish world: the bridge records every payload it is handed.
const pushed: Array<Array<{ name?: string; status?: string; body?: string }>> = []
const bridge = {
  // The read half exists so the full-state push can prove its list is
  // complete（hydration）— a real preload always ships both together.
  listSkillFiles: async () => ({ files: [] }),
  syncSkills: async (skills: Array<{ name?: string; status?: string; body?: string }>) => {
    pushed.push(skills)
    return {
      skillsDir: '/tmp/fake-skills',
      results: skills.map((skill) => ({ name: skill.name, ok: true, slug: String(skill.name).toLowerCase(), filePath: `/tmp/fake-skills/${skill.name}` })),
    }
  },
}
// pushSkillsToHost now forces hydration before building the payload; the
// learning store's plugin-sync path persists settings via localStorage, which
// plain node lacks — a minimal stub keeps the shipped code path intact.
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
;(globalThis as Record<string, unknown>).window = { subagents: { piHost: { resources: bridge } } }

console.log('smoke-skill-host-sync')

const { skillsStore } = await import('../src/agent/hermes/skills.ts')
const { buildHostSkillPayload, pushSkillsToHost } = await import('../src/agent/hermes/skillHostSync.ts')
const { useSkillMigrationStore } = await import('../src/store/skillMigrationStore.ts')

await test('the payload is the WHOLE current list with mapped statuses', () => {
  skillsStore.save({ name: 'deploy-check', description: '部署前檢查', version: '1.0.0', author: 'user', createdBy: 'user' }, '- CI 綠燈')
  const web = skillsStore.get('web-research')
  assert.ok(web)
  skillsStore.pin('web-research')
  const payload = buildHostSkillPayload()
  assert.ok(payload.some((skill) => skill.name === 'deploy-check' && skill.status === 'active'))
  assert.ok(payload.some((skill) => skill.name === 'web-research' && skill.status === 'pinned'),
    'pin must travel as pinned so the Host expands the body up front')
})

await test('a mutation reaches the bridge without anyone remembering to call IPC', async () => {
  useSkillMigrationStore.getState().clear()
  // save() already notified; the subscriber in App would call push. Call it
  // exactly like App does and check what landed on the wire.
  pushSkillsToHost()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(pushed.length, 1, 'exactly one full-list push')
  assert.ok(pushed[0].some((skill) => skill.name === 'deploy-check'), 'the newly saved skill is IN the push')
  const report = useSkillMigrationStore.getState().report
  assert.ok(report?.complete, 'a successful push updates the report where the Learning page reads it')
})

await test('removal propagates: the deleted skill leaves the next push', async () => {
  pushed.length = 0
  skillsStore.remove('deploy-check')
  pushSkillsToHost()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(pushed.length, 1)
  assert.ok(!pushed[0].some((skill) => skill.name === 'deploy-check'), 'the Host reconcile pass can only remove what the payload stops mentioning')
})

await test('without the bridge (plain browser) the push is a silent no-op', async () => {
  const original = (globalThis as Record<string, unknown>).window
  ;(globalThis as Record<string, unknown>).window = {}
  try {
    pushSkillsToHost()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(pushed.length, 1, 'no further call, no throw')
  } finally {
    ;(globalThis as Record<string, unknown>).window = original
  }
})

await test('a failing bridge is REPORTED, not left looking like the last success', async () => {
  const original = (globalThis as Record<string, unknown>).window
  ;(globalThis as Record<string, unknown>).window = {
    subagents: { piHost: { resources: { listSkillFiles: async () => ({ files: [] }), syncSkills: async () => { throw new Error('host is down') } } } },
  }
  try {
    useSkillMigrationStore.getState().setReport({
      at: '2026-08-26T00:00:00.000Z', skillsDir: '/tmp/fake-skills', complete: true,
      outcomes: [{ name: 'old', ok: true as const, slug: 'old' }],
    })
    pushSkillsToHost()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const report = useSkillMigrationStore.getState().report
    assert.ok(report && !report.complete && report.unreachable,
      '「Host 沒同步」與「上一次同步成功」不能長得一樣')
    assert.equal(report?.skillsDir, '/tmp/fake-skills', 'the diagnostic keeps pointing at the directory that should have received the push')
  } finally {
    ;(globalThis as Record<string, unknown>).window = original
  }
})

await test('version skew（old preload，syncSkills 但無 listSkillFiles）degrades to NO-OP', async () => {
  const original = (globalThis as Record<string, unknown>).window
  ;(globalThis as Record<string, unknown>).window = {
    subagents: { piHost: { resources: { syncSkills: bridge.syncSkills } } },
  }
  pushed.length = 0
  try {
    pushSkillsToHost()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(pushed.length, 0,
      'without the read bridge a complete list cannot be established — skipping beats reconciling real Host skills away')
  } finally {
    ;(globalThis as Record<string, unknown>).window = original
  }
})

await test('App keeps subscribing after the one-shot migration flag flips', () => {
  const app = read('src/App.tsx')
  const bootstrap = app.slice(app.indexOf('function SkillsMigrationBootstrap'))
  assert.match(bootstrap, /onSkillsChanged\(pushSkillsToHost\)/,
    'every post-migration mutation must re-push through the same bridge')
})

await test('the migration diagnostics offer an immediate re-push, not just「重新啟動再試」', () => {
  const page = read('src/pages/LearningPage.tsx')
  const diagnostics = page.slice(page.indexOf('function SkillMigrationDiagnostics'))
  assert.match(diagnostics, /pushSkillsToHost\(\)/,
    'the「立即同步」button must call the SAME live push path mutations use')
  assert.match(diagnostics, /立即同步/, 'the retry affordance must be visible where the failure is reported')
})

console.log(`\n${passed} tests passed`)
