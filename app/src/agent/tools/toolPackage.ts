/**
 * ToolPackageManifest: governed, versioned tool packages.
 *
 * A plugin ships tools as a validated manifest where every tool declares its
 * operation class up front. Packages compile into the existing custom-tool
 * pipeline (capability + authorizeTool + supervisor) — never a parallel path.
 *
 * Governance rules:
 * - operationClass is REQUIRED per tool: read | write | destructive | external
 * - write/destructive/external tools compile with requiresApproval (destructive
 *   additionally cannot opt out; bash always approval-gated)
 * - updates that add/escalate non-read tools or change the secret owner produce
 *   a diff with `requiresReview: true` — compiled tools stay read-only until the
 *   user re-approves the package fingerprint (never silent escalation)
 */

import type { CustomToolDefinition } from '../types.ts'

export type OperationClass = 'read' | 'write' | 'destructive' | 'external'

export type ToolPackageTool = {
  name: string
  description: string
  operationClass: OperationClass
  kind: 'http_template' | 'bash_template'
  template: CustomToolDefinition['template']
  params?: CustomToolDefinition['params']
  /** Repeating the call is safe (informational; shown in UI) */
  idempotent?: boolean
  /** Output cap (chars) applied via supervisor payload limits */
  outputLimitChars?: number
  healthCheck?: { kind: 'http'; url: string; expectStatus?: number }
}

export type ToolPackageManifest = {
  schemaVersion: 1
  id: string
  version: string
  description?: string
  auth?: { kind: 'none' | 'pat' | 'api_key' | 'oauth'; secretKey?: string }
  tools: ToolPackageTool[]
}

export type PackageReview = {
  approvedFingerprint: string
  approvedAt: string
  approvedVersion?: string
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const CLASSES: OperationClass[] = ['read', 'write', 'destructive', 'external']

export function validateToolPackage(raw: unknown): {
  ok: boolean
  errors: string[]
  manifest?: ToolPackageManifest
} {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['manifest 必須是物件'] }
  const m = raw as Partial<ToolPackageManifest>
  if (m.schemaVersion !== 1) errors.push(`schemaVersion 必須為 1（收到 ${m.schemaVersion}）`)
  if (!m.id || !NAME.test(String(m.id))) errors.push('id 缺失或不合法')
  if (!m.version || !/^\d+\.\d+(\.\d+)?/.test(String(m.version))) errors.push('version 必須為 semver')
  if (!Array.isArray(m.tools) || m.tools.length === 0) errors.push('tools 至少一個')
  for (const t of m.tools || []) {
    const at = `tool「${t?.name || '?'}」`
    if (!t?.name || !NAME.test(t.name)) errors.push(`${at}: name 不合法`)
    if (!t?.description?.trim()) errors.push(`${at}: description 必填`)
    if (!CLASSES.includes(t?.operationClass as OperationClass))
      errors.push(`${at}: operationClass 必填（read|write|destructive|external）`)
    if (t?.kind !== 'http_template' && t?.kind !== 'bash_template')
      errors.push(`${at}: kind 必須是 http_template 或 bash_template`)
    if (t?.kind === 'http_template' && !/^(https?:\/\/|{{)/i.test(t?.template?.url || ''))
      errors.push(`${at}: http_template 需要 url`)
    if (t?.kind === 'bash_template' && !t?.template?.command?.trim())
      errors.push(`${at}: bash_template 需要 command`)
    // P1: read class must not smuggle write methods
    if (t?.kind === 'http_template' && t.operationClass === 'read') {
      const method = String(t.template?.method || 'GET').toUpperCase()
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        errors.push(
          `${at}: operationClass=read 但 HTTP method=${method} — 請改為 write/destructive/external`,
        )
      }
    }
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, errors: [], manifest: m as ToolPackageManifest }
}

/** Effective operation class after HTTP method sanity. */
export function effectiveOperationClass(t: ToolPackageTool): OperationClass {
  if (t.kind === 'http_template' && t.operationClass === 'read') {
    const method = String(t.template?.method || 'GET').toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'write'
  }
  return t.operationClass
}

/**
 * Fingerprint of the package's PRIVILEGE surface (not cosmetic fields):
 * non-read tool names + classes + kinds + secret owner. Changing any of these
 * invalidates the previous approval.
 */
export function packageFingerprint(m: ToolPackageManifest): string {
  const priv = m.tools
    .filter((t) => effectiveOperationClass(t) !== 'read' || t.kind === 'bash_template')
    .map((t) => `${t.name}:${effectiveOperationClass(t)}:${t.kind}`)
    .sort()
  const base = `${m.auth?.secretKey || ''}|${priv.join(',')}`
  let h = 5381
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/** True when nothing beyond read-class http GET/HEAD tools is present. */
export function packageIsReadOnly(m: ToolPackageManifest): boolean {
  return m.tools.every(
    (t) =>
      effectiveOperationClass(t) === 'read' && t.kind === 'http_template',
  )
}

export type PackageCompileResult = {
  tools: CustomToolDefinition[]
  /** Tools withheld pending review (non-read while unapproved) */
  withheld: string[]
  needsReview: boolean
  fingerprint: string
}

/**
 * Compile to custom tools. Unapproved privilege surface → only read tools
 * are exposed; the rest are withheld (listed for the review UI).
 */
export function compileToolPackage(
  m: ToolPackageManifest,
  ownerId: string,
  review?: PackageReview | null,
): PackageCompileResult {
  const fingerprint = packageFingerprint(m)
  const approved = packageIsReadOnly(m) || review?.approvedFingerprint === fingerprint
  const tools: CustomToolDefinition[] = []
  const withheld: string[] = []
  for (const t of m.tools) {
    const opClass = effectiveOperationClass(t)
    const privileged = opClass !== 'read' || t.kind === 'bash_template'
    if (privileged && !approved) {
      withheld.push(t.name)
      continue
    }
    tools.push({
      name: t.name,
      description: `[${opClass}${t.idempotent ? '·idempotent' : ''}] ${t.description}`,
      kind: t.kind,
      template: t.template,
      params: t.params,
      // destructive/write/external cannot opt out of approval; bash always gated upstream
      requiresApproval: opClass !== 'read',
      ownerId,
    })
  }
  return { tools, withheld, needsReview: !approved, fingerprint }
}

export type PackageDiff = {
  added: string[]
  removed: string[]
  escalations: string[]
  requiresReview: boolean
}

/** Update diff — new/escalated privileges force re-review. */
export function diffToolPackages(
  prev: ToolPackageManifest | null | undefined,
  next: ToolPackageManifest,
): PackageDiff {
  const rank: Record<OperationClass, number> = {
    read: 0,
    external: 1,
    write: 2,
    destructive: 3,
  }
  const prevMap = new Map((prev?.tools || []).map((t) => [t.name, t]))
  const nextMap = new Map(next.tools.map((t) => [t.name, t]))
  const added = [...nextMap.keys()].filter((n) => !prevMap.has(n))
  const removed = [...prevMap.keys()].filter((n) => !nextMap.has(n))
  const escalations: string[] = []
  for (const [name, t] of nextMap) {
    const p = prevMap.get(name)
    if (!p) {
      if (t.operationClass !== 'read' || t.kind === 'bash_template') {
        escalations.push(`${name}（新增 ${t.operationClass}${t.kind === 'bash_template' ? '·bash' : ''}）`)
      }
      continue
    }
    if (rank[t.operationClass] > rank[p.operationClass]) {
      escalations.push(`${name}（${p.operationClass} → ${t.operationClass}）`)
    }
    if (p.kind === 'http_template' && t.kind === 'bash_template') {
      escalations.push(`${name}（http → bash）`)
    }
  }
  if ((prev?.auth?.secretKey || '') !== (next.auth?.secretKey || '')) {
    escalations.push(`secret owner 變更（${prev?.auth?.secretKey || '無'} → ${next.auth?.secretKey || '無'}）`)
  }
  return { added, removed, escalations, requiresReview: escalations.length > 0 }
}

export type PackageHealth = {
  tool: string
  ok: boolean
  status?: number
  error?: string
  checkedAt: string
}

/** Run declared health checks (http only; secrets resolve main-side). */
export async function runToolPackageHealth(
  m: ToolPackageManifest,
): Promise<PackageHealth[]> {
  const out: PackageHealth[] = []
  const api = (
    globalThis as unknown as {
      subagents?: {
        tools?: {
          httpRequest?: (i: {
            url: string
            method?: string
            maxChars?: number
          }) => Promise<{ ok: boolean; status?: number; text: string }>
        }
      }
    }
  ).subagents?.tools?.httpRequest
  for (const t of m.tools) {
    if (!t.healthCheck || t.healthCheck.kind !== 'http') continue
    const checkedAt = new Date().toISOString()
    if (!api) {
      out.push({ tool: t.name, ok: false, error: '需 Electron', checkedAt })
      continue
    }
    try {
      const r = await api({ url: t.healthCheck.url, method: 'GET', maxChars: 200 })
      const expect = t.healthCheck.expectStatus
      const ok = expect ? r.status === expect : r.ok
      out.push({ tool: t.name, ok, status: r.status, checkedAt })
    } catch (e) {
      out.push({
        tool: t.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        checkedAt,
      })
    }
  }
  return out
}
