/**
 * Electron-side owner for External CLI Run Sessions.
 *
 * This module intentionally contains no renderer/store imports. The process
 * transport is injected by the adapter and all session interaction is routed
 * through the registry, keeping concurrent conversations isolated and one
 * process interaction serialized.
 */
import {
  ExternalCliRunSessionRegistry,
  type ExternalCliRunSessionOptions,
} from '../src/agent/externalCliRunSession.ts'

export const externalCliSupervisor = new ExternalCliRunSessionRegistry()

export function createExternalCliSession(options: ExternalCliRunSessionOptions) {
  return externalCliSupervisor.create(options)
}

export function getExternalCliSession(runId: string) {
  return externalCliSupervisor.get(runId)
}

export async function cancelExternalCliSession(runId: string) {
  return externalCliSupervisor.interact(runId, (session) => session.cancel('使用者取消'))
}

/** Host shutdown/restart is an interruption, never an implicit success. */
export function interruptExternalCliSessions(reason = 'Electron host stopped') {
  return externalCliSupervisor
    .snapshots()
    .filter((snapshot) => snapshot.active)
    .map((snapshot) => externalCliSupervisor.get(snapshot.runId)?.markInterrupted(reason))
    .filter(Boolean)
}

export function configureExternalCliPersistence(store: Parameters<ExternalCliRunSessionRegistry['configurePersistence']>[0]) {
  externalCliSupervisor.configurePersistence(store)
}

export function recoverExternalCliSessions(reason?: string) {
  return externalCliSupervisor.recoverPersistedSessions(reason)
}

export function listExternalCliRecovery() {
  return externalCliSupervisor.recoverySnapshots()
}
