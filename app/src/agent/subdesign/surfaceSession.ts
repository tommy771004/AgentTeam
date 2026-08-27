import type { InteractiveSurfaceDeclaration, InteractiveSurfaceKind } from '../openDesign/pluginContract.ts'
import { persistSubDesignMetadata, readSubDesignMetadata } from './metadata.ts'
import type { SurfaceStatus } from './surfaceStatus.ts'

export type SurfaceRuntimeDeclaration = Pick<InteractiveSurfaceDeclaration, 'kind' | 'scope'> & {
  allowlist: string[]
}

export type SurfaceSessionRef = {
  surfaceId: string
  scope: InteractiveSurfaceDeclaration['scope']
  scopeKey: string
}

export type SurfaceSessionSnapshot = SurfaceSessionRef & {
  schemaVersion: 1
  id: string
  kind: InteractiveSurfaceKind
  status: SurfaceStatus
  draft?: Record<string, unknown>
  submission?: Record<string, unknown>
  expiresAt?: string
  updatedAt: string
}

export type SurfaceSessionEvent =
  | { type: 'ready' }
  | { type: 'draft'; values: Record<string, unknown> }
  | { type: 'submitted'; values: Record<string, unknown> }
  | { type: 'invalid' | 'expired' | 'unavailable' | 'error' }

export type SurfaceSessionRepository = {
  load(ref: SurfaceSessionRef): Promise<SurfaceSessionSnapshot | null>
  save(snapshot: SurfaceSessionSnapshot): Promise<boolean>
}

function stableRefId(ref: SurfaceSessionRef): string {
  let hash = 2166136261
  for (const char of `${ref.scope}:${ref.scopeKey}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${ref.surfaceId}-${ref.scope}-${(hash >>> 0).toString(36)}`
}

export function resolveSurfaceSessionRef(
  surfaceId: string,
  declaration: SurfaceRuntimeDeclaration,
  context: { runId?: string; threadId?: string; projectRoot?: string },
): { ok: true; ref: SurfaceSessionRef } | { ok: false; reason: string } {
  const id = String(surfaceId || '').trim()
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) return { ok: false, reason: 'surfaceId 不合法' }
  const scopeKey = declaration.scope === 'run'
    ? context.runId
    : declaration.scope === 'conversation'
      ? context.threadId
      : context.projectRoot
  if (!String(scopeKey || '').trim()) return { ok: false, reason: `${declaration.scope} surface 缺少 scope identity` }
  return { ok: true, ref: { surfaceId: id, scope: declaration.scope, scopeKey: String(scopeKey) } }
}

export function createSurfaceSession(
  ref: SurfaceSessionRef,
  kind: InteractiveSurfaceKind,
  opts?: { expiresAt?: string; now?: string },
): SurfaceSessionSnapshot {
  return {
    schemaVersion: 1,
    id: stableRefId(ref),
    ...ref,
    kind,
    status: 'loading',
    expiresAt: opts?.expiresAt,
    updatedAt: opts?.now || new Date().toISOString(),
  }
}

export function transitionSurfaceSession(
  current: SurfaceSessionSnapshot,
  event: SurfaceSessionEvent,
  now = new Date().toISOString(),
): SurfaceSessionSnapshot {
  if (current.status === 'submitted' && event.type !== 'submitted') return current
  if (event.type === 'draft') return { ...current, draft: { ...event.values }, updatedAt: now }
  if (event.type === 'submitted') {
    return { ...current, status: 'submitted', draft: undefined, submission: { ...event.values }, updatedAt: now }
  }
  return { ...current, status: event.type, updatedAt: now }
}

function isSnapshot(value: unknown): value is SurfaceSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<SurfaceSessionSnapshot>
  return item.schemaVersion === 1 && typeof item.id === 'string' && typeof item.surfaceId === 'string'
    && ['run', 'conversation', 'project'].includes(String(item.scope)) && typeof item.scopeKey === 'string'
    && ['choice', 'form', 'confirmation'].includes(String(item.kind))
    && ['loading', 'ready', 'submitted', 'invalid', 'expired', 'unavailable', 'error'].includes(String(item.status))
}

export function createInMemorySurfaceSessionRepository(): SurfaceSessionRepository {
  const sessions = new Map<string, SurfaceSessionSnapshot>()
  return {
    async load(ref) { return sessions.get(stableRefId(ref)) ?? null },
    async save(snapshot) { sessions.set(snapshot.id, structuredClone(snapshot)); return true },
  }
}

export function createHostSurfaceSessionRepository(projectRoot?: string): SurfaceSessionRepository {
  return {
    async load(ref) {
      if (!projectRoot) return null
      const metadata = await readSubDesignMetadata(projectRoot)
      return metadata?.openDesignSurfaceSessions
        .filter(isSnapshot)
        .find((session) => session.surfaceId === ref.surfaceId && session.scope === ref.scope && session.scopeKey === ref.scopeKey) ?? null
    },
    async save(snapshot) {
      if (!projectRoot) return false
      return persistSubDesignMetadata('open-design-surface-session', snapshot, projectRoot)
    },
  }
}
