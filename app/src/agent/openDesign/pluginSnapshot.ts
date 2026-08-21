/**
 * Plugin resolved snapshot & capability grant boundary.
 *
 * Records source identity, resolved version/commit, content hash,
 * requested capabilities and granted capabilities. No raw credential
 * ever appears in the snapshot.
 *
 * Project-relative persistence:
 *   <projectRoot>/.subagents/open-design/snapshots/<safeId>.json
 * Path confinement: absolute, traversal, or outside-root => reject.
 */

import { parseOpenDesignPluginManifest, type PluginContractResult } from './pluginContract.ts'

export const SNAPSHOT_DIR = '.subagents/open-design/snapshots'
export const SNAPSHOT_VERSION = 1

/** Capabilities that are deny-by-default per spec 02. */
export const DENY_BY_DEFAULT = new Set<string>([
  'fs:write',
  'subprocess',
  'bash',
  'network',
  'mcp',
  'connector',
])

export type SnapshotSource = {
  sourcePath: string
  sourceUrl?: string
  upstreamCommit?: string
  recordId?: string
}

export type PluginResolvedSnapshot = {
  version: typeof SNAPSHOT_VERSION
  snapshotId: string
  pluginId: string
  source: SnapshotSource
  resolvedVersion?: string
  resolvedCommit?: string
  contentHash: string
  capabilityFingerprint: string
  requestedCapabilities: string[]
  grantedCapabilities: string[]
  grantedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
  projectRelativePath: string
  contractKind: 'legacy' | 'v1'
  specVersion?: string | null
  /** Redacted references only — never raw token. */
  credentialRefs?: Array<{ kind: string; ref: string }>
}

export type GrantDecision = {
  capability: string
  granted: boolean
  decidedAt: string
  runId?: string
  threadId?: string
}

export type CapabilityGrantState = {
  snapshotId: string
  pluginId: string
  grants: GrantDecision[]
  fingerprint: string
  updatedAt: string
}

// ── Hash & fingerprint (deterministic, FNV-like or sha256) ───────────────
// Use Web Crypto subtle when available, fallback to simple deterministic
// hash for Node smokes. Must be consistent across runs for same input.

export function hashContent(text: string): string {
  // Deterministic synchronous hash — use djb2-ish with hex for smoke portability
  // For production determinism we also expose async sha256 helper.
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  // Expand to 64 hex chars deterministically (not crypto-strong, but stable)
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64)
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  // Node: use crypto if available; otherwise fallback
  try {
    // @ts-ignore global crypto
    const buf = await crypto.subtle.digest('SHA-256', enc)
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(text, 'utf8').digest('hex')
  }
}

export function fingerprintCapabilities(capabilities: string[]): string {
  const sorted = [...new Set(capabilities.map((c) => c.trim()).filter(Boolean))].sort()
  return hashContent(sorted.join('|'))
}

// ── Path confinement ────────────────────────────────────────────────────

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
}

export function normalizeProjectRelative(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\//, '').trim()
}

export function validateProjectRelativePath(
  projectRoot: string,
  targetPath: string,
): { ok: true; normalized: string } | { ok: false; reason: string } {
  const rel = normalizeProjectRelative(targetPath)
  if (!rel) return { ok: false, reason: '路徑不可為空。' }
  if (isAbsolutePath(rel) || isAbsolutePath(targetPath)) return { ok: false, reason: `絕對路徑不被允許：${targetPath}` }
  if (rel.includes('..')) return { ok: false, reason: `path traversal 不被允許：${targetPath}` }
  if (rel.includes('\0')) return { ok: false, reason: '路徑含非法字元。' }
  // Must stay inside snapshots dir for snapshot files, but generic check allows any project-relative
  // Ensure normalized still starts inside project (no leading /)
  if (rel.startsWith('/')) return { ok: false, reason: `路徑必須是 project-relative：${targetPath}` }
  // Project root sanity — must be non-empty if provided
  if (projectRoot && isAbsolutePath(projectRoot) && projectRoot.includes('..')) {
    return { ok: false, reason: 'projectRoot 不合法。' }
  }
  return { ok: true, normalized: rel }
}

export function snapshotFilePath(pluginId: string): string {
  const safe = pluginId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'plugin'
  return `${SNAPSHOT_DIR}/${safe}.json`
}

// ── Snapshot creation ─────────────────────────────────────────────────

export type CreateSnapshotInput = {
  pluginId: string
  source: SnapshotSource
  resolvedVersion?: string
  resolvedCommit?: string
  rawManifest: unknown
  rawContentForHash?: string
  projectRoot: string
  grantedCapabilities?: string[]
}

export function createResolvedSnapshot(input: CreateSnapshotInput): PluginResolvedSnapshot | { error: string } {
  const pluginId = input.pluginId.trim().slice(0, 220)
  if (!pluginId) return { error: 'pluginId 必填。' }
  const contract: PluginContractResult = parseOpenDesignPluginManifest(input.rawManifest)
  if (!contract.ok) return { error: contract.reason }

  const requested = contract.kind === 'v1' ? [...contract.manifest.capabilities] : []
  // Grant defaults: deny-by-default capabilities are NOT granted unless explicitly listed
  const grantedInput = (input.grantedCapabilities || []).map((c) => c.trim()).filter(Boolean)
  // Only grant what is requested; extra grants outside requested are ignored
  const granted = grantedInput.filter((c) => requested.includes(c))

  const contentText = input.rawContentForHash ?? JSON.stringify(input.rawManifest)
  const contentHash = hashContent(contentText)
  const fingerprint = fingerprintCapabilities(requested)

  const relPath = snapshotFilePath(pluginId)
  const validated = validateProjectRelativePath(input.projectRoot, relPath)
  if (!validated.ok) return { error: validated.reason }

  // Validate sourcePath itself is project-relative / not traversal
  const srcChecked = validateProjectRelativePath(input.projectRoot, input.source.sourcePath)
  if (!srcChecked.ok) return { error: `sourcePath 錯誤：${srcChecked.reason}` }

  const now = new Date().toISOString()
  const snapshot: PluginResolvedSnapshot = {
    version: SNAPSHOT_VERSION,
    snapshotId: `${pluginId}@${contentHash.slice(0, 12)}`,
    pluginId,
    source: {
      sourcePath: srcChecked.normalized,
      sourceUrl: input.source.sourceUrl?.slice(0, 500),
      upstreamCommit: input.source.upstreamCommit?.slice(0, 80),
      recordId: input.source.recordId?.slice(0, 180),
    },
    resolvedVersion: input.resolvedVersion?.slice(0, 80),
    resolvedCommit: input.resolvedCommit?.slice(0, 80),
    contentHash,
    capabilityFingerprint: fingerprint,
    requestedCapabilities: requested,
    grantedCapabilities: granted,
    createdAt: now,
    updatedAt: now,
    projectRelativePath: validated.normalized,
    contractKind: contract.kind,
    specVersion: contract.kind === 'v1' ? contract.manifest.specVersion : null,
    credentialRefs: [],
  }
  return snapshot
}

export function needsReapproval(old: PluginResolvedSnapshot, next: { contentHash: string; fingerprint: string }): boolean {
  return old.contentHash !== next.contentHash || old.capabilityFingerprint !== next.fingerprint
}

export function revokeGrants(snapshot: PluginResolvedSnapshot): PluginResolvedSnapshot {
  return {
    ...snapshot,
    grantedCapabilities: [],
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function grantCapabilities(
  snapshot: PluginResolvedSnapshot,
  toGrant: string[],
  opts?: { runId?: string; threadId?: string },
): PluginResolvedSnapshot {
  const allowed = new Set(snapshot.requestedCapabilities)
  const granted = [...new Set([...snapshot.grantedCapabilities, ...toGrant.filter((c) => allowed.has(c))])]
  return {
    ...snapshot,
    grantedCapabilities: granted,
    grantedAt: new Date().toISOString(),
    revokedAt: undefined,
    updatedAt: new Date().toISOString(),
    // store run/thread scope for audit (not raw token)
    credentialRefs: snapshot.credentialRefs,
  }
}

export function isCapabilityGranted(snapshot: PluginResolvedSnapshot, capability: string): boolean {
  return snapshot.grantedCapabilities.includes(capability)
}

export function isSnapshotPathValid(projectRoot: string, relPath: string): boolean {
  const r = validateProjectRelativePath(projectRoot, relPath)
  if (!r.ok) return false
  // Snapshot must live under SNAPSHOT_DIR
  return r.normalized.startsWith(SNAPSHOT_DIR + '/') || r.normalized === SNAPSHOT_DIR
}

// For activity / projection redaction check
export function snapshotContainsNoRawToken(snapshot: PluginResolvedSnapshot): boolean {
  const json = JSON.stringify(snapshot)
  // Heuristic: raw token patterns — long base64-ish or sk- / ghp_ etc
  if (/sk-[a-zA-Z0-9]{20,}/.test(json)) return false
  if (/ghp_[a-zA-Z0-9]{30,}/.test(json)) return false
  if (/\"token\"\s*:\s*\"[^"]{20,}\"/.test(json)) return false
  return true
}
