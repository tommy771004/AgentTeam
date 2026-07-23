import { createInterface } from 'node:readline'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPiHostServer, type PiHostMessage } from './piHostProtocol.ts'
import { loadPiHostState, savePiHostState, type PiHostSnapshot } from './piHostState.ts'
import { migrateLegacySettings } from './piSettingsMigration.ts'
import { persistPiLegacyCredential, persistPiLegacyModelConfig } from './piCoreRuntime.ts'

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: PiHostMessage): void
}

const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort
const statePath = process.env.SUBAGENTS_PI_HOST_STATE_PATH || `${process.cwd()}/pi-host-state.json`
const storedState = await loadPiHostState(statePath)
const migrationPath = process.env.SUBAGENTS_PI_SETTINGS_MIGRATION_PATH || path.join(path.dirname(statePath), 'pi-settings-migration.json')
let migratedSettings = storedState.settings
try {
  await readFile(migrationPath, 'utf8')
} catch {
  const legacyPath = process.env.SUBAGENTS_LEGACY_SETTINGS_PATH
  if (legacyPath) {
    try {
      const legacy = JSON.parse(await readFile(legacyPath, 'utf8')) as Record<string, unknown>
      const migration = migrateLegacySettings({
          provider: legacy.provider || legacy.apiProvider,
          model: legacy.model,
          baseUrl: legacy.baseUrl,
        thinkingLevel: legacy.thinkingLevel,
        activeTools: legacy.activeTools,
        compaction: legacy.compaction,
        approvalMode: legacy.approvalMode,
        unattended: legacy.unattended,
        apiKey: legacy.apiKey,
      })
      const modelConfigPersisted = await persistPiLegacyModelConfig(migration.modelConfig)
      if (migration.modelConfig && !modelConfigPersisted) throw new Error('Pi legacy model endpoint could not be persisted')
      if (migration.credential) {
        await persistPiLegacyCredential(migration.credential.provider, migration.credential.apiKey)
      }
      migratedSettings = {
        ...migration.settings,
        ...storedState.settings,
        provider: storedState.settings.provider || migration.settings.provider,
        model: storedState.settings.model || migration.settings.model,
      }
      await writeFile(migrationPath, JSON.stringify({
        version: migration.version,
        completedAt: new Date().toISOString(),
        modelConfigPersisted,
        credentialPersisted: Boolean(migration.credential),
      }) + '\n', { mode: 0o600 })
    } catch (error) {
      // Do not write the completion marker: a later host restart retries safely.
      console.error('[pi-host] legacy settings migration pending', error)
    }
  }
}
const initialSnapshot: PiHostSnapshot = { cursor: storedState.cursor, sessions: storedState.sessions, settings: migratedSettings, queue: storedState.queue, resources: storedState.resources, memories: storedState.memories, extensions: storedState.extensions }
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
