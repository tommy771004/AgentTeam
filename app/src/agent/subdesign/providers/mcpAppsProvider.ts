/**
 * SubDesign MCP Apps interactive surfaces — choice / form / confirmation.
 * Sandboxed iframe + CSP + versioned schema validation + allowlist.
 * Always has native fallback.
 */
import { isProviderEnabled } from './providerFlags.ts'
import type { ProviderAvailability } from './providerContract.ts'

export type SurfaceKind = 'choice' | 'form' | 'confirmation'
export type SurfaceScope = 'run' | 'conversation' | 'project'

export type SurfaceDeclaration = {
  kind: SurfaceKind
  scope: SurfaceScope
  allowlist: string[] // tool allowlist
}

export type BridgeMessage = {
  v: 1
  surfaceId: string
  kind: SurfaceKind
  action: string
  payload?: unknown
}

const ALLOWLIST_LIMIT = 16
const PAYLOAD_BUDGET = 8 * 1024

export function mcpAppsAvailability(): ProviderAvailability {
  if (!isProviderEnabled('mcp-apps')) return { available: false, reason: 'MCP Apps provider 未啟用（feature flag 關閉）', code: 'unavailable' }
  return { available: true }
}

export function validateSurfaceDeclaration(raw: unknown): { ok: true; decl: SurfaceDeclaration } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'surface 必須是 object' }
  const r = raw as Record<string, unknown>
  const kind = String(r.kind || '')
  if (!['choice', 'form', 'confirmation'].includes(kind)) return { ok: false, reason: `未知 surface kind: ${kind}` }
  const scope = String(r.scope || 'run')
  if (!['run', 'conversation', 'project'].includes(scope)) return { ok: false, reason: `未知 scope: ${scope}` }
  const allowlist = Array.isArray(r.allowlist) ? r.allowlist.map((x) => String(x).trim()).filter(Boolean) : []
  if (allowlist.length > ALLOWLIST_LIMIT) return { ok: false, reason: 'allowlist 過長' }
  for (const a of allowlist) if (!/^[a-z_][a-z0-9_.-]{1,63}$/.test(a)) return { ok: false, reason: `allowlist 含非法 tool 名：${a}` }
  return { ok: true, decl: { kind: kind as SurfaceKind, scope: scope as SurfaceScope, allowlist } }
}

export function validateBridgeMessage(raw: unknown, opts?: { expectedOrigin?: string; actualOrigin?: string }): { ok: true; msg: BridgeMessage } | { ok: false; reason: string } {
  if (opts?.expectedOrigin && opts?.actualOrigin && opts.expectedOrigin !== opts.actualOrigin) {
    return { ok: false, reason: `untrusted origin: ${opts.actualOrigin}` }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'bridge payload 必須是 object' }
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return { ok: false, reason: 'bridge 版本不支援（需 v=1）' }
  const kind = String(r.kind || '')
  if (!['choice', 'form', 'confirmation'].includes(kind)) return { ok: false, reason: `未知 kind: ${kind}` }
  const surfaceId = String(r.surfaceId || '').trim()
  if (!surfaceId || !/^[a-zA-Z0-9._-]{1,80}$/.test(surfaceId)) return { ok: false, reason: 'surfaceId 不合法' }
  const action = String(r.action || '').trim()
  if (!action || action.length > 40) return { ok: false, reason: 'action 不合法' }
  // Disallow prohibited navigation
  if (typeof r.payload === 'object' && r.payload && typeof (r.payload as Record<string, unknown>).navigate === 'string') {
    const nav = String((r.payload as Record<string, unknown>).navigate)
    if (/^https?:\/\//.test(nav) || nav.startsWith('//')) return { ok: false, reason: 'prohibited navigation' }
  }
  const json = JSON.stringify(r)
  if (new TextEncoder().encode(json).length > PAYLOAD_BUDGET) return { ok: false, reason: 'oversized payload' }
  return { ok: true, msg: { v: 1, surfaceId, kind: kind as SurfaceKind, action, payload: r.payload } }
}

export function isToolAllowed(surface: SurfaceDeclaration, toolName: string): boolean {
  return surface.allowlist.includes(toolName)
}

export function parseMcpToolCoordinate(value: string): { extensionId: string; toolName: string } | null {
  const separator = value.indexOf('.')
  if (separator <= 0 || separator === value.length - 1) return null
  const extensionId = value.slice(0, separator)
  const toolName = value.slice(separator + 1)
  if (!/^[a-z0-9_-]{1,64}$/i.test(extensionId) || !/^[a-z_][a-z0-9_.-]{1,127}$/i.test(toolName)) return null
  return { extensionId, toolName }
}

export const CSP_SANDBOX = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none';"
