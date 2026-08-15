import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PI_SETTINGS, isPiThinkingLevel, type PiSettings } from './piAgentProfile.ts'
import type { PiHostConfigStatus } from './piHostProtocol.ts'
import type { SessionRecord } from './piHostProtocol.ts'
import type { PiQueuedRun } from './piRunQueue.ts'
import type { PiResource } from './piResourceRegistry.ts'
import { isPiMemory, type PiMemory } from './piMemoryExtension.ts'
import type { PiExtension } from './piExtensionRegistry.ts'

export type PiHostSnapshot = {
  cursor: number
  sessions: SessionRecord[]
  settings: PiSettings
  /** Native Pi config is the initial source; an explicit app save makes it managed. */
  settingsOrigin?: 'native' | 'managed'
  config?: PiHostConfigStatus
  queue: PiQueuedRun[]
  resources: PiResource[]
  memories: PiMemory[]
  extensions: PiExtension[]
}

type StoredState = PiHostSnapshot & { schemaVersion: 1 }

const emptyState = (): StoredState => ({
  schemaVersion: 1,
  cursor: 0,
  sessions: [],
  settings: { ...DEFAULT_PI_SETTINGS },
  settingsOrigin: 'native',
  queue: [],
  resources: [],
  memories: [],
  extensions: [],
})

export async function loadPiHostState(statePath: string): Promise<StoredState> {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8')) as Partial<StoredState>
    if (
      value.schemaVersion !== 1 ||
      typeof value.cursor !== 'number' ||
      !Array.isArray(value.sessions) ||
      !Array.isArray(value.queue || []) ||
      !value.settings ||
      typeof value.settings.model !== 'string' ||
      !Array.isArray(value.settings.activeTools)
    ) {
      return emptyState()
    }
    const settings: PiSettings = {
      provider: value.settings.provider || DEFAULT_PI_SETTINGS.provider,
      model: value.settings.model,
      thinkingLevel: isPiThinkingLevel(value.settings.thinkingLevel) ? value.settings.thinkingLevel : DEFAULT_PI_SETTINGS.thinkingLevel,
      activeTools: [...value.settings.activeTools],
      compaction: value.settings.compaction === 'manual' ? 'manual' : 'auto',
      approvalMode: value.settings.approvalMode === 'always' || value.settings.approvalMode === 'full' ? value.settings.approvalMode : DEFAULT_PI_SETTINGS.approvalMode,
      bashRequireAsk: value.settings.bashRequireAsk !== false,
      unattended: value.settings.unattended === true,
    }
    const legacyStateHasRuntimeOverride = settings.provider !== DEFAULT_PI_SETTINGS.provider
      || settings.model !== DEFAULT_PI_SETTINGS.model
      || settings.thinkingLevel !== DEFAULT_PI_SETTINGS.thinkingLevel
      || settings.activeTools.length > 0
      || settings.compaction !== DEFAULT_PI_SETTINGS.compaction
      || settings.approvalMode !== DEFAULT_PI_SETTINGS.approvalMode
      || settings.bashRequireAsk !== DEFAULT_PI_SETTINGS.bashRequireAsk
      || settings.unattended !== DEFAULT_PI_SETTINGS.unattended
    return {
      schemaVersion: 1,
      cursor: value.cursor,
      sessions: value.sessions,
      settings,
      settingsOrigin: value.settingsOrigin === 'managed' || (value.settingsOrigin !== 'native' && legacyStateHasRuntimeOverride) ? 'managed' : 'native',
      config: value.config,
      queue: (value.queue || []).filter((item): item is PiQueuedRun => Boolean(item && typeof item === 'object' && typeof (item as PiQueuedRun).runId === 'string')),
      resources: Array.isArray(value.resources) ? value.resources : [],
      memories: Array.isArray(value.memories) ? value.memories.filter(isPiMemory) : [],
      extensions: Array.isArray(value.extensions) ? value.extensions : [],
    }
  } catch {
    return emptyState()
  }
}

export async function savePiHostState(statePath: string, snapshot: PiHostSnapshot): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ schemaVersion: 1, ...snapshot }), 'utf8')
  await rename(temporaryPath, statePath)
}
