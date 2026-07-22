import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceFiles = [
  'src/App.tsx',
  'src/hooks/useSlashExecutor.ts',
  'src/agent/hermes/backgroundJobs.ts',
  'src/agent/hermes/delegate.ts',
]

for (const relativePath of sourceFiles) {
  const source = await readFile(resolve(root, relativePath), 'utf8')
  assert.match(source, /runTask\s*\(/, `${relativePath} must submit through runTask`)
  assert.doesNotMatch(source, /runExternalObjective|AgentSessionRuntime|dispatchThreadTask\s*\(/, `${relativePath} bypasses the canonical ingress`)
}

const coordinator = await readFile(resolve(root, 'src/agent/taskRunCoordinator.ts'), 'utf8')
assert.match(coordinator, /const runId = normalized\.runId \|\| `run_\$\{uuid\(\)/)
assert.match(coordinator, /onSettled\?:/) 
assert.match(coordinator, /await input\.onSettled\?\./)
assert.match(coordinator, /drainExternalRunQueue/)
assert.match(coordinator, /reserveRunCapacity/)

console.log('all supported external sources use the durable Task run ingress')
