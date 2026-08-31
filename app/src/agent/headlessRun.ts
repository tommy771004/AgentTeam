/**
 * Development/evaluation-only Node seam; it is not a product distribution
 * surface (ADR-0046).
 *
 * This module deliberately exposes the coordinator, not a second runner. It
 * installs only the smallest Electron-shaped globals needed by renderer-safe
 * stores while keeping the browser document absent, then restores the globals
 * before returning.
 */
import { createMemoryStorage } from './memoryStorage.ts'
import { setLlmTransport, type LlmTransport } from './llm.ts'
import { runTask, type TaskRunInput, type TaskRunResult } from './taskRunCoordinator.ts'
import type { LlmSettings } from './types.ts'

export type HeadlessRunOptions = Omit<TaskRunInput, 'sourceKind' | 'unattended'> & {
  /** Scripted transport for deterministic evaluation; omitted uses normal transport. */
  transport?: LlmTransport
  /** Temporary settings patch, restored after the run. */
  settingsPatch?: Partial<LlmSettings>
  /** Optional caller-owned storage for evaluation projections. */
  storage?: Storage
  /** Evaluation-only bridge to a real Host lifecycle (never a renderer-owned runner). */
  subagents?: NonNullable<Window['subagents']>
}

type HeadlessStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}

let sharedNodeStorage: HeadlessStorage | undefined

function installNodeGlobals(preferredStorage?: Storage, subagents?: NonNullable<Window['subagents']>): {
  restore: () => void
  storage: HeadlessStorage
} {
  const runtime = globalThis as typeof globalThis & {
    window?: { subagents?: Record<string, unknown> }
    localStorage?: HeadlessStorage
  }
  const hadWindow = 'window' in runtime
  const hadStorage = 'localStorage' in runtime
  const previousStorage = runtime.localStorage
  const nodeRuntime =
    typeof process !== 'undefined' && Boolean(process.versions?.node) && typeof document === 'undefined'
  const storage = preferredStorage || (nodeRuntime
    ? (sharedNodeStorage ||= createMemoryStorage())
    : previousStorage &&
        typeof previousStorage.getItem === 'function' &&
        typeof previousStorage.setItem === 'function'
      ? previousStorage
      : createMemoryStorage())
  const replaceWindow = !hadWindow
  const replaceStorage = !hadStorage || runtime.localStorage !== storage

  if (replaceWindow) {
    Object.defineProperty(runtime, 'window', {
      configurable: true,
      value: { subagents: subagents || {} },
    })
  }
  if (replaceStorage) {
    Object.defineProperty(runtime, 'localStorage', {
      configurable: true,
      value: storage,
    })
  }

  return {
    storage,
    restore: () => {
      if (replaceWindow) Reflect.deleteProperty(runtime, 'window')
      if (replaceStorage && hadStorage) {
        Object.defineProperty(runtime, 'localStorage', {
          configurable: true,
          value: previousStorage,
        })
      } else if (replaceStorage) {
        Reflect.deleteProperty(runtime, 'localStorage')
      }
    },
  }
}

/** Execute one task through taskRunCoordinator without importing UI modules. */
export async function runHeadlessTask(opts: HeadlessRunOptions): Promise<TaskRunResult> {
  const globals = installNodeGlobals(opts.storage, opts.subagents)
  const { useSettingsStore } = opts.settingsPatch
    ? await import('../store/settingsStore.ts')
    : { useSettingsStore: null }
  const previousSettings = useSettingsStore?.getState().settings
  const patch = opts.settingsPatch || (opts.transport ? { enabled: true } : undefined)
  setLlmTransport(opts.transport)
  try {
    if (useSettingsStore && patch) {
      await useSettingsStore.getState().update(patch)
    }
    return await runTask({
      ...opts,
      sourceKind: 'headless',
      unattended: true,
      overrides: {
        ...(opts.overrides || {}),
        unattended: true,
      },
    })
  } finally {
    setLlmTransport()
    if (useSettingsStore && previousSettings) {
      await useSettingsStore.getState().update(previousSettings)
    }
    globals.restore()
  }
}
