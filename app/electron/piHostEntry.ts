import { createInterface } from 'node:readline'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPiHostServer, type PiHostConfigStatus, type PiHostMessage } from './piHostProtocol.ts'
import { savePiHostState, type PiHostSnapshot } from './piHostState.ts'
import { migrateLegacySettings } from './piSettingsMigration.ts'
import { buildPiSubscriptionModelView, disposeAllPiSessions, persistPiLegacyCredential, persistPiLegacyModelConfig } from './piCoreRuntime.ts'
import { assembleSubscriptionCatalog, resolveCatalogPublication } from '../src/agent/subscriptionCatalog.ts'
import { bootstrapPiUserConfig } from './piUserConfig.ts'
import { stopAllPiMcp } from './piMcpClient.ts'
import { registerTrustedBuiltinShellSandboxAdapter } from './piBuiltinShellSandbox.ts'
import { createSeatbeltBuiltinShellAdapter } from './piSeatbeltShellSandbox.ts'
import { createBubblewrapBuiltinShellAdapter } from './piBubblewrapShellSandbox.ts'
import { JsonCompactionCheckpointStore } from './compactionCheckpointStore.ts'
import { openPiHostStorage } from './piHostStorage.ts'
import { MemoryStorageLifecycleError, storageLifecycleError } from './memoryStorageLifecycle.ts'

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: PiHostMessage): void
}

/**
 * The builtin-shell sandbox adapter is installed HERE, in the Host process, at
 * startup (ADR-0051, issue 13). Registration is trusted main-side code with no
 * IPC, renderer, or model path into it; installing it once at boot also means
 * the seam cannot acquire a second owner mid-run.
 *
 * macOS (Seatbelt) and Linux (bubblewrap) are claimed. Every other platform
 * installs nothing, so verification reports `unsupported` and ADR-0047's
 * `required` denial stands unchanged — an unimplemented platform is honestly
 * unsupported, never silently downgraded to optional. Installing an adapter is
 * still not permission to run: each one must pass its own probe and both
 * canaries per run before a command is confined and allowed.
 */
const builtinShellAdapter = process.platform === 'darwin'
  ? createSeatbeltBuiltinShellAdapter()
  : process.platform === 'linux'
    ? createBubblewrapBuiltinShellAdapter()
    : undefined
if (builtinShellAdapter) {
  try {
    registerTrustedBuiltinShellSandboxAdapter(builtinShellAdapter)
  } catch {
    /* A second registration is refused by the seam; the first owner stands. */
  }
}

const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort
const statePath = process.env.SUBAGENTS_PI_HOST_STATE_PATH || `${process.cwd()}/pi-host-state.json`
const checkpointDir = process.env.SUBAGENTS_PI_CHECKPOINT_DIR || path.join(path.dirname(statePath), 'run-checkpoints')
const compactionCheckpoints = new JsonCompactionCheckpointStore(checkpointDir)
const durableMemoryPath = process.env.SUBAGENTS_DURABLE_MEMORY_DB_PATH || path.join(path.dirname(statePath), 'durable-memory.sqlite')
const publishStorageFailure = (error: unknown) => {
  const lifecycle = error instanceof MemoryStorageLifecycleError
    ? error
    : storageLifecycleError(error, 'storage_unavailable', '長期記憶 storage 啟動失敗；未覆寫原資料。')
  const event: PiHostMessage = { event: 'host/storage-health', payload: lifecycle.health }
  if (parentPort) parentPort.postMessage(event)
  else process.stdout.write(`${JSON.stringify(event)}\n`)
  return lifecycle
}
const { snapshot: storedState, memoryStore: durableMemoryStore } = await openPiHostStorage(statePath, durableMemoryPath)
  .catch((error) => { throw publishStorageFailure(error) })
const userConfig = await bootstrapPiUserConfig()
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
      // ENOENT means no legacy settings file exists (fresh install or isolated E2E profile).
      // This is expected and not an error — silently skip migration.
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.error('[pi-host] legacy settings migration pending', error)
      }
    }
  }
}
const settingsOrigin = storedState.settingsOrigin === 'managed' ? 'managed' : 'native'
const effectiveSettings = settingsOrigin === 'native'
  ? { ...migratedSettings, ...userConfig.settings }
  : migratedSettings
// The selectable-subscription surface rides in the same
// snapshot config as the OAuth status it projects from. A model-view failure
// lands as per-provider reasons — the rows stay, honestly unavailable. When a
// degraded build meets a last-good snapshot, the offline fallback
// republishes that cache marked stale instead of showing an empty world.
async function buildSubscriptionConfig(
  currentUserConfig: Awaited<ReturnType<typeof bootstrapPiUserConfig>>,
  previousConfig?: PiHostConfigStatus,
): Promise<PiHostConfigStatus> {
  const oauthSyncStatus = {
    oauthImportedProviders: currentUserConfig.oauth.importedProviders,
    oauthSkippedProviders: currentUserConfig.oauth.skippedProviders,
    oauthConflicts: currentUserConfig.oauth.conflicts,
  }
  const subscriptionModelView = await buildPiSubscriptionModelView()
  const previousSubscriptionCatalog = previousConfig?.subscriptionCatalog?.length
    ? { catalog: previousConfig.subscriptionCatalog, builtAt: previousConfig.subscriptionCatalogCachedAt || 0 }
    : undefined
  const publishedCatalog = resolveCatalogPublication(
    assembleSubscriptionCatalog(oauthSyncStatus, subscriptionModelView.models, subscriptionModelView.errors),
    previousSubscriptionCatalog,
    Date.now(),
    subscriptionModelView.errors,
  )
  return {
    settingsSource: settingsOrigin === 'managed' ? 'managed' : currentUserConfig.settingsPath ? 'native' : 'default',
    settingsLoaded: Boolean(currentUserConfig.settingsPath),
    oauthSources: currentUserConfig.oauth.sourceKinds,
    ...oauthSyncStatus,
    subscriptionCatalog: publishedCatalog.catalog,
    ...(publishedCatalog.stale ? { subscriptionCatalogStale: true } : {}),
    subscriptionCatalogCachedAt: publishedCatalog.builtAt,
  }
}

const config = await buildSubscriptionConfig(userConfig, storedState.config)
let latestSubscriptionConfig = config
let refreshSubscriptionConfigInFlight: Promise<PiHostConfigStatus> | undefined
const refreshSubscriptionConfig = (): Promise<PiHostConfigStatus> => {
  if (refreshSubscriptionConfigInFlight) return refreshSubscriptionConfigInFlight
  refreshSubscriptionConfigInFlight = (async () => {
    const refreshedUserConfig = await bootstrapPiUserConfig()
    const refreshedConfig = await buildSubscriptionConfig(refreshedUserConfig, latestSubscriptionConfig)
    latestSubscriptionConfig = refreshedConfig
    return refreshedConfig
  })().finally(() => { refreshSubscriptionConfigInFlight = undefined })
  return refreshSubscriptionConfigInFlight
}
const initialSnapshot: PiHostSnapshot = { ...storedState, settings: effectiveSettings, settingsOrigin, config }
await savePiHostState(statePath, initialSnapshot)
let persistence = Promise.resolve()
const persist = (snapshot: typeof initialSnapshot) => {
  persistence = persistence
    .then(() => savePiHostState(statePath, snapshot))
    .catch((error) => console.error('[pi-host] state persistence failed', error))
}

type HostSend = (message: PiHostMessage) => void
type InitialSnapshot = typeof initialSnapshot
type Persist = typeof persist
type RefreshSubscriptionConfig = typeof refreshSubscriptionConfig
type CompactionCheckpoints = typeof compactionCheckpoints
const createConfiguredHost = (
  send: HostSend,
  initialSnapshot: InitialSnapshot,
  persist: Persist,
  refreshSubscriptionConfig: RefreshSubscriptionConfig,
  compactionCheckpoints: CompactionCheckpoints,
) => createPiHostServer(send, initialSnapshot, persist, refreshSubscriptionConfig, compactionCheckpoints, durableMemoryStore)
const createEntryHost = (
  send: HostSend,
  initialSnapshot: InitialSnapshot,
  persist: Persist,
  refreshSubscriptionConfig: RefreshSubscriptionConfig,
) => createConfiguredHost(send, initialSnapshot, persist, refreshSubscriptionConfig, compactionCheckpoints)

if (parentPort) {
  const server = createEntryHost((message) => parentPort.postMessage(message), initialSnapshot, persist, refreshSubscriptionConfig)
  parentPort.on('message', (event) => server.handle(event.data))
} else {
  const server = createEntryHost((message) => process.stdout.write(`${JSON.stringify(message)}\n`), initialSnapshot, persist, refreshSubscriptionConfig)
  const inFlight = new Set<Promise<void>>()
  const dispatch = (request: unknown) => {
    const pending = server.handle(request)
    inFlight.add(pending)
    void pending.finally(() => inFlight.delete(pending))
  }
  const input = createInterface({ input: process.stdin })
  input.on('line', (line) => {
    try {
      dispatch(JSON.parse(line) as unknown)
    } catch {
      dispatch(null)
    }
  })
  // MCP stdio children retain pipe handles. Release every discovery
  // generation when the supervising stdio channel closes, otherwise a clean
  // Host shutdown can hang after an extension reload qualification.
  input.on('close', async () => {
    try {
      await Promise.all(inFlight)
      await persistence
      stopAllPiMcp()
      await disposeAllPiSessions()
      await durableMemoryStore.close()
    } catch (error) {
      process.exitCode = 1
      console.error('[pi-host] bounded shutdown failed', publishStorageFailure(error))
    }
  })
}
