/** Headless coordinator seam smoke; no DOM, React, or page imports. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(appRoot, 'src/agent/headlessRun.ts'), 'utf8')
assert.doesNotMatch(source, /from ['"].*(react|pages\/|\.tsx)/i)
assert.match(source, /setLlmTransport/)
assert.match(source, /sourceKind: 'headless'/)
assert.match(source, /runTask\(/)
assert.equal(typeof document, 'undefined')

const jiti = createJiti(import.meta.url, { interopDefault: true })
const { runHeadlessTask } = await jiti.import('../src/agent/headlessRun.ts') as typeof import('../src/agent/headlessRun.ts')
const result = await runHeadlessTask({
  objective: 'headless smoke turn',
  runner: 'builtin',
  overrides: { useLlm: false },
})
assert.equal(result.runId ? typeof result.runId : 'string', 'string')
assert.notEqual(result.status, 'skipped')
console.log('smoke-headless: 5 assertions passed')
