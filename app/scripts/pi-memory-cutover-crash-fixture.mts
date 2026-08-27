import { join } from 'node:path'
import { openPiHostStorage, type PiStorageTransition } from '../electron/piHostStorage.ts'

// A separate process exits at the shipped startup owner's observable boundary.
// No test-only environment switch exists in the production Host entry.
const [directory, phase] = process.argv.slice(2)
const opened = await openPiHostStorage(join(directory, 'state.json'), join(directory, 'durable-memory.sqlite'), (current) => {
  if (current === phase as PiStorageTransition) process.exit(73)
})
await opened.memoryStore.close()
throw new Error(`Cutover never reached ${phase}`)
