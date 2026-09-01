import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PI_SETTINGS, isPiThinkingLevel, type PiSettings } from './piAgentProfile.ts'
import type { PiHostConfigStatus } from './piHostProtocol.ts'
import type { SessionRecord } from './piHostProtocol.ts'
import type { PiQueuedRun } from './piRunQueue.ts'
import type { PiResource } from './piResourceRegistry.ts'
import type { PiMemory } from './piMemory.ts'
import { parseTurnRecord } from '../src/agent/turnRecord.ts'
import type { PiExtension } from './piExtensionRegistry.ts'
import { isPiTurnToolContract, type PiTurnToolContract } from './piToolContract.ts'
import type { PiHostAttachment } from './piHostAttachment.ts'

export type PiHostSnapshot = {
  cursor: number
  sessions: SessionRecord[]
  settings: PiSettings
  /** Native Pi config is the initial source; an explicit app save makes it managed. */
  settingsOrigin?: 'native' | 'managed'
  config?: PiHostConfigStatus
  queue: PiQueuedRun[]
  resources: PiResource[]
  extensions: PiExtension[]
  /** Host-canonical run attachment metadata; Turn Record entries are not copied. */
  attachments: PiHostAttachment[]
  memoryAuthority?: { backend: 'sqlite'; sourceHash: string }
}

export type PiHostStoredState = PiHostSnapshot & { schemaVersion: number }
type ParsedStoredState = PiHostStoredState & { memories?: PiMemory[] }

const emptyState = (): ParsedStoredState => ({
  schemaVersion: 2,
  cursor: 0,
  sessions: [],
  settings: { ...DEFAULT_PI_SETTINGS },
  settingsOrigin: 'native',
  queue: [],
  resources: [],
  memories: [],
  extensions: [],
  attachments: [],
})

function normalizeStoredSettings(settings: PiSettings): PiSettings {
  return {
    provider: settings.provider || DEFAULT_PI_SETTINGS.provider,
    model: settings.model,
    thinkingLevel: isPiThinkingLevel(settings.thinkingLevel) ? settings.thinkingLevel : DEFAULT_PI_SETTINGS.thinkingLevel,
    activeTools: [...settings.activeTools],
    compaction: settings.compaction === 'manual' ? 'manual' : 'auto',
    approvalMode: settings.approvalMode === 'always' || settings.approvalMode === 'full' ? settings.approvalMode : DEFAULT_PI_SETTINGS.approvalMode,
    bashRequireAsk: settings.bashRequireAsk !== false,
    unattended: settings.unattended === true,
    followCliOAuthAccount: settings.followCliOAuthAccount !== false,
    workspaceTextSearch: settings.workspaceTextSearch === true,
  }
}

function hasRuntimeOverride(settings: PiSettings): boolean {
  return settings.provider !== DEFAULT_PI_SETTINGS.provider
    || settings.model !== DEFAULT_PI_SETTINGS.model
    || settings.thinkingLevel !== DEFAULT_PI_SETTINGS.thinkingLevel
    || settings.activeTools.length > 0
    || settings.compaction !== DEFAULT_PI_SETTINGS.compaction
    || settings.approvalMode !== DEFAULT_PI_SETTINGS.approvalMode
    || settings.bashRequireAsk !== DEFAULT_PI_SETTINGS.bashRequireAsk
    || settings.unattended !== DEFAULT_PI_SETTINGS.unattended
    || settings.followCliOAuthAccount !== DEFAULT_PI_SETTINGS.followCliOAuthAccount
    || settings.workspaceTextSearch !== DEFAULT_PI_SETTINGS.workspaceTextSearch
}

/**
 * Validate every session's Turn Record before the Host serves any of it.
 *
 * Deliberately outside the parse `catch`: an unreadable record must reach the
 * caller as a failure. Falling back to an empty state here would turn "this
 * build cannot read your history" into "you have no history" — data loss
 * performed rather than reported. A damaged FINAL entry is different: that is a
 * torn append, so the good prefix is kept and the loss is reported.
 */
function withValidatedTurnRecords(state: PiHostStoredState): PiHostStoredState {
  const sessions = state.sessions.map((session) => {
    const { record, tornTail } = parseTurnRecord((session as { record?: unknown }).record)
    if (tornTail) {
      console.error(`[pi-host] Turn Record for session ${session.id} lost a torn final entry; keeping ${record.entries.length} entries`)
    }
    const toolContracts = Array.isArray(session.toolContracts)
      ? session.toolContracts.filter(isPiTurnToolContract)
      : []
    return record.entries.length > 0 || (session as { record?: unknown }).record !== undefined
      ? { ...session, record, toolContracts }
      : { ...session, toolContracts }
  })
  return { ...state, sessions }
}

function validateMemoryAuthority(value: Partial<ParsedStoredState>): void {
  if (value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    if (value.memoryAuthority !== undefined) throw new Error('Legacy state 不可宣告 SQLite authority。')
    return
  }
  const memoryShapeValid = value.schemaVersion === 3 ? value.memories?.length === 0 : value.memories === undefined
  if (value.memoryAuthority?.backend !== 'sqlite' || typeof value.memoryAuthority.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.memoryAuthority.sourceHash) || !memoryShapeValid) {
    throw new Error('Pi Host SQLite authority marker 無效；未覆寫資料。')
  }
}

function parseStoredPiHostState(source: string): ParsedStoredState {
  let value: Partial<ParsedStoredState>
  try {
    value = JSON.parse(source) as Partial<ParsedStoredState>
  } catch {
    throw new Error('Pi Host state JSON 損壞；未覆寫資料，請從有效備份復原。')
  }
  if (!value || typeof value !== 'object') throw new Error('Pi Host state 格式無效；未覆寫資料。')
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    throw new Error('Pi Host state schema 不相容；未覆寫資料，請使用相容版本或明確匯出後再降級。')
  }
  validateMemoryAuthority(value)
  if (
    typeof value.cursor !== 'number' ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.queue || []) ||
    (value.memories !== undefined && !Array.isArray(value.memories)) ||
    !value.settings ||
    typeof value.settings.model !== 'string' ||
    !Array.isArray(value.settings.activeTools)
  ) {
    throw new Error('Pi Host state 結構無效；未覆寫資料，請從有效備份復原。')
  }
  return value as ParsedStoredState
}

export async function resolvePiHostStateFile(statePath: string): Promise<string> {
  try { return (await lstat(statePath)).isDirectory() ? path.join(statePath, 'snapshot.json') : statePath } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return statePath
    throw error
  }
}

async function readStoredPiHostState(statePath: string): Promise<PiHostStoredState> {
  const filePath = await resolvePiHostStateFile(statePath)
  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && filePath === statePath) return emptyState()
    throw new Error('Pi Host state 無法讀取；未覆寫資料，請檢查檔案權限或從備份復原。', { cause: error })
  }
  return decodePiHostState(source)
}

export function decodePiHostState(source: string): PiHostStoredState {
  const value = parseStoredPiHostState(source)
  const settings = normalizeStoredSettings(value.settings)
  const legacyStateHasRuntimeOverride = hasRuntimeOverride(settings)
  return withValidatedTurnRecords({
    schemaVersion: value.schemaVersion,
    cursor: value.cursor,
    sessions: value.sessions.map((session) => ({
      ...session,
      toolContracts: Array.isArray(session.toolContracts)
        ? session.toolContracts.filter(isPiTurnToolContract) as PiTurnToolContract[]
        : [],
    })),
    settings,
    settingsOrigin: value.settingsOrigin === 'managed' || (value.settingsOrigin !== 'native' && legacyStateHasRuntimeOverride) ? 'managed' : 'native',
    config: value.config,
    queue: (value.queue || []).filter((item): item is PiQueuedRun => Boolean(item && typeof item === 'object' && typeof (item as PiQueuedRun).runId === 'string')),
    resources: Array.isArray(value.resources) ? value.resources : [],
    extensions: Array.isArray(value.extensions) ? value.extensions : [],
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    ...(value.memoryAuthority ? { memoryAuthority: value.memoryAuthority } : {}),
  })
}

export async function loadPiHostState(statePath: string): Promise<PiHostStoredState> {
  return readStoredPiHostState(statePath)
}

export async function savePiHostState(statePath: string, snapshot: PiHostSnapshot): Promise<void> {
  const filePath = await resolvePiHostStateFile(statePath)
  if (snapshot.memoryAuthority && filePath === statePath) throw new Error('SQLite Host state 必須使用已切換的檔案佈局；拒絕恢復 legacy JSON。')
  if (filePath !== statePath && !snapshot.memoryAuthority) throw new Error('拒絕以 legacy snapshot 覆寫 SQLite Host state。')
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ ...snapshot, schemaVersion: snapshot.memoryAuthority ? 4 : 2 }), { mode: 0o600 })
  await rename(temporaryPath, filePath)
}
