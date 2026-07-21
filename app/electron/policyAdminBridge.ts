/**
 * Policy Admin disk lifecycle under Electron main policy dir.
 * Drafts live in drafts/; activate writes company-base.json / providers/*.json.
 * Never returns protected content from user projects — only policy JSON.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
  validateCompanyBasePolicy,
  validateProviderSupplementalPolicy,
  type CompanyBasePolicy,
  type ProviderSupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import {
  assertPolicyAdminWriteAllowed,
  PolicyAdminStore,
} from '../src/agent/outbound/policyAdmin.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import {
  appendEvidenceRecord,
  type AppendEvidenceInput,
} from '../src/agent/outbound/evidenceLedger.ts'

/** Default policy dir when Electron app is available; smokes pass policyDir explicitly. */
export function outboundPolicyDir(): string {
  const override = (process.env.SUBAGENTS_OUTBOUND_POLICY_DIR || '').trim()
  if (override) return path.resolve(override)
  // Prefer Electron userData when this module is loaded inside main (set by main on boot).
  if (process.env.SUBAGENTS_USER_DATA_DIR?.trim()) {
    return path.join(process.env.SUBAGENTS_USER_DATA_DIR.trim(), 'outbound-policy')
  }
  return path.join(os.tmpdir(), 'subagents-outbound-policy')
}

function recordPolicyEvidence(policyDir: string, input: AppendEvidenceInput): void {
  // Local unsealed trail under policy dir for admin actions (no secrets).
  void appendEvidenceRecord(input, {
    ledgerDir: path.join(policyDir, '_admin-evidence'),
    keyProvider: {
      async getKey() {
        return Buffer.from('policy-admin-local-hmac-key!!')
      },
    },
    sealed: false,
  })
}

function draftsDir(policyDir: string) {
  return path.join(policyDir, 'drafts')
}

function providersDir(policyDir: string) {
  return path.join(policyDir, 'providers')
}

function connectionFileName(connectionId: string): string {
  return `${connectionId.replace(/[/:]/g, '_')}.json`
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export type ActivePolicySummary = {
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  version: number
  changeId: string
  path: string
  detectorCount: number
}

export function listActivePolicies(policyDir = outboundPolicyDir()): ActivePolicySummary[] {
  const out: ActivePolicySummary[] = []
  const basePath = path.join(policyDir, 'company-base.json')
  if (fs.existsSync(basePath)) {
    try {
      const body = validateCompanyBasePolicy(readJson(basePath))
      out.push({
        kind: 'company-base',
        version: body.version,
        changeId: body.changeId,
        path: basePath,
        detectorCount: body.detectors?.length || 0,
      })
    } catch {
      out.push({
        kind: 'company-base',
        version: 0,
        changeId: 'malformed',
        path: basePath,
        detectorCount: 0,
      })
    }
  }
  const pdir = providersDir(policyDir)
  if (fs.existsSync(pdir)) {
    for (const name of fs.readdirSync(pdir).filter((n) => n.endsWith('.json'))) {
      const p = path.join(pdir, name)
      try {
        const body = validateProviderSupplementalPolicy(readJson(p))
        out.push({
          kind: 'provider-supplement',
          connectionId: body.connectionId,
          version: body.version,
          changeId: body.changeId,
          path: p,
          detectorCount: body.extraDetectors?.length || 0,
        })
      } catch {
        out.push({
          kind: 'provider-supplement',
          connectionId: name,
          version: 0,
          changeId: 'malformed',
          path: p,
          detectorCount: 0,
        })
      }
    }
  }
  return out
}

export type DraftSummary = {
  id: string
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  updatedAtUtc: string
  version?: number
  changeId?: string
}

export function listPolicyDrafts(policyDir = outboundPolicyDir()): DraftSummary[] {
  const dir = draftsDir(policyDir)
  if (!fs.existsSync(dir)) return []
  const out: DraftSummary[] = []
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const p = path.join(dir, name)
    try {
      const raw = readJson(p) as {
        id?: string
        kind?: string
        connectionId?: string
        updatedAtUtc?: string
        body?: { version?: number; changeId?: string }
      }
      out.push({
        id: String(raw.id || name.replace(/\.json$/, '')),
        kind: raw.kind === 'provider-supplement' ? 'provider-supplement' : 'company-base',
        connectionId: raw.connectionId,
        updatedAtUtc: raw.updatedAtUtc || '',
        version: raw.body?.version,
        changeId: raw.body?.changeId,
      })
    } catch {
      /* skip bad draft */
    }
  }
  return out.sort((a, b) => (b.updatedAtUtc || '').localeCompare(a.updatedAtUtc || ''))
}

export function readPolicyDraft(
  draftId: string,
  policyDir = outboundPolicyDir(),
): { ok: true; draft: unknown } | { ok: false; reason: string } {
  const p = path.join(draftsDir(policyDir), `${draftId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
  if (!fs.existsSync(p)) return { ok: false, reason: 'draft not found' }
  try {
    return { ok: true, draft: readJson(p) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export function savePolicyDraft(input: {
  id: string
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  body: unknown
  policyDir?: string
}): { ok: true; draft: DraftSummary } | { ok: false; reason: string } {
  const writeGate = assertPolicyAdminWriteAllowed(process.env.SUBAGENTS_BUILD_FLAVOR)
  if (!writeGate.ok) return writeGate
  const policyDir = input.policyDir || outboundPolicyDir()
  const store = new PolicyAdminStore()
  const r = store.saveDraft({
    id: input.id,
    kind: input.kind,
    connectionId: input.connectionId,
    body: input.body,
  })
  if (!r.ok) return r
  const file = path.join(
    draftsDir(policyDir),
    `${String(input.id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  )
  writeJsonAtomic(file, r.draft)
  return {
    ok: true,
    draft: {
      id: r.draft.id,
      kind: r.draft.kind,
      connectionId: r.draft.connectionId,
      updatedAtUtc: r.draft.updatedAtUtc,
      version: (r.draft.body as { version?: number }).version,
      changeId: (r.draft.body as { changeId?: string }).changeId,
    },
  }
}

export function activatePolicyDraft(input: {
  draftId: string
  policyDir?: string
}): { ok: true; active: ActivePolicySummary } | { ok: false; reason: string } {
  const writeGate = assertPolicyAdminWriteAllowed(process.env.SUBAGENTS_BUILD_FLAVOR)
  if (!writeGate.ok) return writeGate
  const policyDir = input.policyDir || outboundPolicyDir()
  const loaded = readPolicyDraft(input.draftId, policyDir)
  if (!loaded.ok) return loaded
  const draft = loaded.draft as {
    id: string
    kind: 'company-base' | 'provider-supplement'
    connectionId?: string
    body: unknown
  }

  try {
    if (draft.kind === 'company-base') {
      const body = validateCompanyBasePolicy(draft.body)
      const basePath = path.join(policyDir, 'company-base.json')
      if (fs.existsSync(basePath)) {
        try {
          const prev = validateCompanyBasePolicy(readJson(basePath))
          if (body.version <= prev.version) {
            return {
              ok: false,
              reason: `version must increase (active=${prev.version}, draft=${body.version})`,
            }
          }
        } catch {
          /* allow activate over malformed */
        }
      }
      writeJsonAtomic(basePath, body)
      recordPolicyEvidence(policyDir, {
        eventType: 'policy-change',
        policyVersion: String(body.version),
        changeId: body.changeId,
        action: 'activate-company-base',
        exclusions: [],
      })
      return {
        ok: true,
        active: {
          kind: 'company-base',
          version: body.version,
          changeId: body.changeId,
          path: basePath,
          detectorCount: body.detectors.length,
        },
      }
    }

    const body = validateProviderSupplementalPolicy(draft.body)
    // monotonic merge check against current base
    const basePath = path.join(policyDir, 'company-base.json')
    const base = fs.existsSync(basePath)
      ? validateCompanyBasePolicy(readJson(basePath))
      : BUILTIN_BASELINE_POLICY
    compileProviderSecurityProfile(base, body)

    const dest = path.join(providersDir(policyDir), connectionFileName(body.connectionId))
    if (fs.existsSync(dest)) {
      try {
        const prev = validateProviderSupplementalPolicy(readJson(dest))
        if (body.version <= prev.version) {
          return {
            ok: false,
            reason: `version must increase (active=${prev.version}, draft=${body.version})`,
          }
        }
      } catch {
        /* allow */
      }
    }
    writeJsonAtomic(dest, body)
    recordPolicyEvidence(policyDir, {
      eventType: 'policy-change',
      policyVersion: String(body.version),
      changeId: body.changeId,
      providerId: body.connectionId,
      action: 'activate-provider-supplement',
      exclusions: [],
    })
    return {
      ok: true,
      active: {
        kind: 'provider-supplement',
        connectionId: body.connectionId,
        version: body.version,
        changeId: body.changeId,
        path: dest,
        detectorCount: body.extraDetectors.length,
      },
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export function rollbackActivePolicy(input: {
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  reason: string
  /** Optional body to restore; if omitted, re-write builtin/empty with bumped version */
  targetBody?: unknown
  policyDir?: string
}): { ok: true; active: ActivePolicySummary } | { ok: false; reason: string } {
  const writeGate = assertPolicyAdminWriteAllowed(process.env.SUBAGENTS_BUILD_FLAVOR)
  if (!writeGate.ok) return writeGate
  const policyDir = input.policyDir || outboundPolicyDir()
  try {
    if (input.kind === 'company-base') {
      const basePath = path.join(policyDir, 'company-base.json')
      if (!fs.existsSync(basePath)) return { ok: false, reason: 'no active company-base' }
      const prev = validateCompanyBasePolicy(readJson(basePath))
      const target = input.targetBody
        ? validateCompanyBasePolicy(input.targetBody)
        : BUILTIN_BASELINE_POLICY
      const next: CompanyBasePolicy = {
        ...target,
        version: prev.version + 1,
        changeId: `rollback-${prev.changeId}-to-v${target.version}`,
      }
      writeJsonAtomic(basePath, next)
      recordPolicyEvidence(policyDir, {
        eventType: 'policy-rollback',
        policyVersion: String(next.version),
        changeId: next.changeId,
        action: `rollback: ${input.reason.slice(0, 120)}`,
        exclusions: [],
      })
      return {
        ok: true,
        active: {
          kind: 'company-base',
          version: next.version,
          changeId: next.changeId,
          path: basePath,
          detectorCount: next.detectors.length,
        },
      }
    }

    const connectionId = input.connectionId
    if (!connectionId) return { ok: false, reason: 'connectionId required' }
    const dest = path.join(providersDir(policyDir), connectionFileName(connectionId))
    if (!fs.existsSync(dest)) return { ok: false, reason: 'no active provider supplement' }
    const prev = validateProviderSupplementalPolicy(readJson(dest))
    const target = input.targetBody
      ? validateProviderSupplementalPolicy(input.targetBody)
      : emptySupplementalPolicy(connectionId)
    const next: ProviderSupplementalPolicy = {
      ...target,
      connectionId,
      version: prev.version + 1,
      changeId: `rollback-${prev.changeId}-to-v${target.version}`,
    }
    writeJsonAtomic(dest, next)
    recordPolicyEvidence(policyDir, {
      eventType: 'policy-rollback',
      policyVersion: String(next.version),
      changeId: next.changeId,
      providerId: connectionId,
      action: `rollback: ${input.reason.slice(0, 120)}`,
      exclusions: [],
    })
    return {
      ok: true,
      active: {
        kind: 'provider-supplement',
        connectionId,
        version: next.version,
        changeId: next.changeId,
        path: dest,
        detectorCount: next.extraDetectors.length,
      },
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Seed a draft from current active base for editing (non-secret metadata only in summary). */
export function seedDraftFromActive(input: {
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  draftId: string
  policyDir?: string
}): { ok: true; draft: DraftSummary } | { ok: false; reason: string } {
  const writeGate = assertPolicyAdminWriteAllowed(process.env.SUBAGENTS_BUILD_FLAVOR)
  if (!writeGate.ok) return writeGate
  const policyDir = input.policyDir || outboundPolicyDir()
  try {
    if (input.kind === 'company-base') {
      const basePath = path.join(policyDir, 'company-base.json')
      const body = fs.existsSync(basePath)
        ? validateCompanyBasePolicy(readJson(basePath))
        : BUILTIN_BASELINE_POLICY
      const bumped = {
        ...body,
        version: body.version + 1,
        changeId: `draft-${Date.now().toString(36)}`,
      }
      return savePolicyDraft({
        id: input.draftId,
        kind: 'company-base',
        body: bumped,
        policyDir,
      })
    }
    const connectionId = input.connectionId
    if (!connectionId) return { ok: false, reason: 'connectionId required' }
    const dest = path.join(providersDir(policyDir), connectionFileName(connectionId))
    const body = fs.existsSync(dest)
      ? validateProviderSupplementalPolicy(readJson(dest))
      : emptySupplementalPolicy(connectionId)
    const bumped = {
      ...body,
      version: body.version + 1,
      changeId: `draft-${Date.now().toString(36)}`,
    }
    return savePolicyDraft({
      id: input.draftId,
      kind: 'provider-supplement',
      connectionId,
      body: bumped,
      policyDir,
    })
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
