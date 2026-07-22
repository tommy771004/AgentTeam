import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PI_SETTINGS, type PiSettings } from './piAgentProfile.ts'
import type { SessionRecord } from './piHostProtocol.ts'
import type { PiQueuedRun } from './piRunQueue.ts'
import type { PiResource } from './piResourceRegistry.ts'

export type PiHostSnapshot = {
  cursor: number
  sessions: SessionRecord[]
  settings: PiSettings
  queue: PiQueuedRun[]
  resources: PiResource[]
}

type StoredState = PiHostSnapshot & { schemaVersion: 1 }

const emptyState = (): StoredState => ({
  schemaVersion: 1,
  cursor: 0,
  sessions: [],
  settings: { ...DEFAULT_PI_SETTINGS },
  queue: [],
  resources: [],
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
    return {
      schemaVersion: 1,
      cursor: value.cursor,
      sessions: value.sessions,
      settings: {
        provider: value.settings.provider || DEFAULT_PI_SETTINGS.provider,
        model: value.settings.model,
        thinkingLevel: value.settings.thinkingLevel || DEFAULT_PI_SETTINGS.thinkingLevel,
        activeTools: [...value.settings.activeTools],
        compaction: value.settings.compaction === 'manual' ? 'manual' : 'auto',
        approvalMode: value.settings.approvalMode === 'always' || value.settings.approvalMode === 'full' ? value.settings.approvalMode : DEFAULT_PI_SETTINGS.approvalMode,
        unattended: value.settings.unattended === true,
      },
      queue: (value.queue || []).filter((item): item is PiQueuedRun => Boolean(item && typeof item === 'object' && typeof (item as PiQueuedRun).runId === 'string')),
      resources: Array.isArray(value.resources) ? value.resources : [],
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
