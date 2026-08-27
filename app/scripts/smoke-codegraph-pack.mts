import assert from 'node:assert/strict'
import { buildCodegraphPack } from '../electron/piExtensionPacks/codegraph.ts'
import { codegraphInstallCommandFor } from '../electron/codegraphBridge.ts'

const installCommand = codegraphInstallCommandFor('/path with spaces/npm')
assert.match(installCommand, /@colbymchenry\/codegraph@latest$/)
assert.match(installCommand, /install --global --no-audit --no-fund/)

const status = {
  installed: true,
  binaryPath: '/fixture/codegraph',
  projectRoot: '/fixture/project',
  indexed: false,
  indexPath: null,
  version: '1.0.0',
  raw: '',
  error: '專案尚未 codegraph init',
}
const exploreCalls: Array<{ root: string; query: string; maxFiles?: number }> = []
const pack = buildCodegraphPack({
  status: async () => status,
  explore: async (root, query, options) => {
    exploreCalls.push({ root, query, maxFiles: options?.maxFiles })
    return { ok: true, projectRoot: root, query, output: 'ok', command: 'fixture' }
  },
  callers: async (root, query) => ({ ok: true, projectRoot: root, query, output: 'ok', command: 'fixture' }),
  impact: async (root, query) => ({ ok: true, projectRoot: root, query, output: 'ok', command: 'fixture' }),
})
const tool = (name: string) => {
  const found = pack.tools.find((candidate) => candidate.name === name)
  assert.ok(found, `${name} exists in the Host pack`)
  return found
}
const context = { cwd: '/fixture/project' } as never

const unindexed = await tool('codegraph_explore').execute({ query: 'runTask', limit: 8 }, context)
assert.match(JSON.stringify(unindexed), /尚未建立索引/)
assert.equal(exploreCalls.length, 0, 'unindexed is a readable status and never invokes the CLI query')

const statusResult = await tool('codegraph_status').execute({}, context)
assert.match(JSON.stringify(statusResult), /專案尚未 codegraph init/)

status.indexed = true
await tool('codegraph_explore').execute({ query: 'runTask', limit: 999 }, context)
await tool('codegraph_explore').execute({ query: 'runTask' }, context)
assert.deepEqual(exploreCalls.map((call) => call.maxFiles), [40, 20], 'limit reaches the bridge and is bounded')

console.log('CodeGraph Host pack reports unindexed state and forwards bounded explore limits')
