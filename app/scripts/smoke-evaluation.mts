import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tasks = JSON.parse(fs.readFileSync(path.join(appRoot, 'evaluation/tasks.json'), 'utf8'))
assert.equal(Array.isArray(tasks), true)
assert.equal(tasks.length, 3)

const jiti = createJiti(import.meta.url, { interopDefault: true })
const { runEvaluationBatch } = await jiti.import('../src/agent/evaluationHarness.ts') as typeof import('../src/agent/evaluationHarness.ts')
const result = await runEvaluationBatch(tasks, { settingsPatch: { enabled: false } })
assert.equal(result.tasks.length, tasks.length)
assert.equal(Array.isArray(result.journal), true)
assert.equal(Array.isArray(result.artifacts), true)
for (const task of result.tasks) {
  assert.equal(typeof task.journal?.status, 'string')
  assert.equal(task.journal?.runId, task.runId)
}
console.log(`smoke-evaluation: ${result.tasks.length} tasks projected from journal/artifact index`)
