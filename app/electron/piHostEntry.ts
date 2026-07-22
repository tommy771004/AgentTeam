import { createInterface } from 'node:readline'
import { createPiHostServer, type PiHostMessage } from './piHostProtocol.ts'
import { loadPiHostState, savePiHostState, type PiHostSnapshot } from './piHostState.ts'

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: PiHostMessage): void
}

const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort
const statePath = process.env.SUBAGENTS_PI_HOST_STATE_PATH || `${process.cwd()}/pi-host-state.json`
const storedState = await loadPiHostState(statePath)
const initialSnapshot: PiHostSnapshot = { cursor: storedState.cursor, sessions: storedState.sessions, settings: storedState.settings, queue: storedState.queue, resources: storedState.resources }
await savePiHostState(statePath, initialSnapshot)
let persistence = Promise.resolve()
const persist = (snapshot: typeof initialSnapshot) => {
  persistence = persistence
    .then(() => savePiHostState(statePath, snapshot))
    .catch((error) => console.error('[pi-host] state persistence failed', error))
}

if (parentPort) {
  const server = createPiHostServer((message) => parentPort.postMessage(message), initialSnapshot, persist)
  parentPort.on('message', (event) => server.handle(event.data))
} else {
  const server = createPiHostServer((message) => process.stdout.write(`${JSON.stringify(message)}\n`), initialSnapshot, persist)
  const input = createInterface({ input: process.stdin })
  input.on('line', (line) => {
    try {
      server.handle(JSON.parse(line) as unknown)
    } catch {
      server.handle(null)
    }
  })
}
