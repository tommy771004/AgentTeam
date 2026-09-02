import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const preload = read('electron/preload.ts')
const main = read('electron/main.ts')
const sessionDomain = read('electron/piHostSessionDomain.ts')
const legacyDelegate = read('src/agent/hermes/delegate.ts')
const queuePump = read('src/agent/hostAgentQueuePump.ts')
const communication = read('electron/piAgentCommunicationDomain.ts')

assert.doesNotMatch(preload, /sessions:create-child|createChild\s*:/, 'renderer preload must not expose direct child-session creation')
assert.doesNotMatch(main, /pi-host:sessions:create-child/, 'main process must not relay the retired child-session bypass')
assert.match(sessionDomain, /Child sessions must be admitted through agents\/spawn/, 'sessions/create must fail closed for parentSessionId')
assert.doesNotMatch(legacyDelegate, /runTask\s*\(/, 'legacy renderer delegate must not execute a Task run')
assert.equal(
  existsSync(new URL('../src/agent/hermes/backgroundJobs.ts', import.meta.url)),
  false,
  'retired renderer background projection must stay removed',
)
assert.match(queuePump, /runTask\s*\(/, 'Host queue adapter must use the sole Task run coordinator')
assert.match(communication, /enqueuePiHostRun\s*\(/, 'Host communication domain must own child run admission')

console.log('agent collaboration boundary is host-owned')
