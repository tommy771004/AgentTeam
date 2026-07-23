import { strict as assert } from 'node:assert'
import { selectToolsForStep } from '../src/agent/tools/registry.ts'

const previousWindow = (globalThis as { window?: unknown }).window
;(globalThis as { window?: unknown }).window = {
  subagents: { platform: async () => 'darwin', piHost: { sessions: { list: async () => ({ sessions: [] }) } } },
}
try {
  const tools = selectToolsForStep('run a bash command', 'inspect the project with shell', 'bash')
  assert.equal(tools.includes('bash'), false)
} finally {
  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
  else (globalThis as { window?: unknown }).window = previousWindow
}
console.log('Electron Pi Host owns Bash; legacy renderer selection is disabled')
