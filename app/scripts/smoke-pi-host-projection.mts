import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = {
  id?: number
  result?: { cursor?: number; sessions?: unknown[]; queue?: unknown[] }
  event?: string
}

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const stateDir = await mkdtemp(join(tmpdir(), 'subagents-pi-host-'))
const statePath = join(stateDir, 'state.json')

const start = () => {
  const child = spawn(process.execPath, [hostEntry], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const output = createInterface({ input: child.stdout })
  const messages: Message[] = []
  output.on('line', (line) => messages.push(JSON.parse(line) as Message))
  const waitFor = async (predicate: (message: Message) => boolean) => {
    for (;;) {
      const current = messages.find(predicate)
      if (current) return current
      await once(output, 'line')
    }
  }
  return { child, waitFor }
}

const request = (child: ChildProcessWithoutNullStreams, id: number, method: string) => {
  child.stdin.write(`${JSON.stringify({ id, method, params: { protocolVersion: 1 } })}\n`)
}

try {
  const first = start()
  request(first.child, 1, 'initialize')
  await first.waitFor((message) => message.id === 1)
  request(first.child, 2, 'state/snapshot')
  const firstSnapshot = await first.waitFor((message) => message.id === 2)
  assert.deepEqual(firstSnapshot.result, { cursor: 0, sessions: [], queue: [], resources: [], memories: [] })
  first.child.kill()
  await once(first.child, 'exit')

  const second = start()
  request(second.child, 3, 'initialize')
  await second.waitFor((message) => message.id === 3)
  request(second.child, 4, 'state/snapshot')
  const secondSnapshot = await second.waitFor((message) => message.id === 4)
  assert.deepEqual(secondSnapshot.result, { cursor: 0, sessions: [], queue: [], resources: [], memories: [] })
  second.child.stdin.end()
  await once(second.child, 'exit')
} finally {
  await rm(stateDir, { recursive: true, force: true })
}

console.log('pi host state projection survives restart')
