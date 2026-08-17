/**
 * Ticket 03: capability inspection must say *how* each entry was unlocked, and
 * reset must clear the thread's carried state without discarding the thread.
 * Reads the state capabilities/runtime.ts already holds — no new persistence.
 */
import assert from 'node:assert/strict'
import {
  assembleCapabilities,
  inspectCapabilityState,
  loadCapability,
  searchTools,
} from '../src/agent/capabilities/runtime.ts'
import { DEFAULT_LLM_SETTINGS } from '../src/agent/llm.ts'

let passed = 0
const check = (label: string, fn: () => void) => {
  try {
    fn()
  } catch (error) {
    console.error(`smoke-capability-inspection FAILED: ${label}`)
    throw error
  }
  passed += 1
}

const settings = { ...DEFAULT_LLM_SETTINGS, functionCalling: true, progressiveCapabilities: true }

check('always-on capabilities are labelled as such, not as preloaded', () => {
  const state = assembleCapabilities(settings)
  const inspection = inspectCapabilityState(state)
  const alwaysOn = inspection.capabilities.filter((entry) => !entry.deferLoading)
  assert.ok(alwaysOn.length > 0, 'expected at least one always-on capability')
  for (const entry of alwaysOn) assert.equal(entry.provenance, 'always-on')
})

check('preloaded ids are distinguishable from always-on ones', () => {
  const base = assembleCapabilities(settings)
  const deferred = base.all.find((cap) => cap.deferLoading)
  assert.ok(deferred, 'expected a deferred capability to preload')
  const state = assembleCapabilities(settings, { preloadIds: [deferred.id] })
  const entry = inspectCapabilityState(state).capabilities.find((item) => item.id === deferred.id)
  assert.equal(entry?.provenance, 'preloaded')
})

check('load_capability records itself as the unlock mechanism', () => {
  const state = assembleCapabilities(settings)
  const deferred = state.all.find((cap) => cap.deferLoading)
  assert.ok(deferred)
  loadCapability(state, deferred.id)
  const entry = inspectCapabilityState(state).capabilities.find((item) => item.id === deferred.id)
  assert.equal(entry?.provenance, 'load_capability')
  assert.notEqual(entry?.provenance, 'preloaded', 'must not be reported as merely preloaded')
})

check('tool_search records itself and is not confused with load_capability', () => {
  const state = assembleCapabilities({ ...settings, toolSearchThreshold: 1 })
  assert.equal(state.toolSearch.active, true, 'threshold 1 must activate tool search')
  const deferred = state.all.find((cap) => cap.deferLoading && (cap.tools || []).length > 0)
  assert.ok(deferred, 'expected a deferred capability owning explicit tools')
  const target = (deferred.tools || [])[0]
  const pool = state.all.flatMap((cap) =>
    (cap.tools || []).map((name) => ({
      type: 'function' as const,
      function: { name, description: name, parameters: { type: 'object' } },
    })),
  )
  const result = searchTools(state, pool, target)
  assert.equal(result.ok, true, `tool_search must find ${target}`)
  const tool = inspectCapabilityState(state).unlockedTools.find((item) => item.name === target)
  assert.equal(tool?.provenance, 'tool_search', `${target} must be attributed to tool_search`)
})

check('restored cross-run tools are labelled restored, not silently preloaded', () => {
  const state = assembleCapabilities(settings, { preloadUnlockedTools: ['web_search'] })
  const tool = inspectCapabilityState(state).unlockedTools.find((item) => item.name === 'web_search')
  assert.equal(tool?.provenance, 'restored')
})

check('every inspected entry carries a provenance value', () => {
  const state = assembleCapabilities(settings)
  const inspection = inspectCapabilityState(state)
  const allowed = new Set([
    'always-on',
    'preloaded',
    'load_capability',
    'tool_search',
    'progressive-off',
    'restored',
  ])
  for (const entry of inspection.capabilities) {
    assert.ok(allowed.has(entry.provenance), `${entry.id} has provenance ${entry.provenance}`)
  }
  for (const tool of inspection.unlockedTools) {
    assert.ok(allowed.has(tool.provenance), `${tool.name} has provenance ${tool.provenance}`)
  }
})

check('inspection introduces no new persistence layer', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/agent/capabilities/runtime.ts', import.meta.url), 'utf8'),
  )
  assert.doesNotMatch(source, /localStorage|indexedDB|window\.subagents\?\.\w*[sS]tore/)
})

console.log(`smoke-capability-inspection: ${passed} groups passed`)
