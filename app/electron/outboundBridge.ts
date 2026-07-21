/**
 * Outbound Data Gate — Electron main ownership of policy dir, evidence ledger, run views.
 * Renderer only receives non-sensitive status / view paths.
 */

import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import {
  parseDeployOutboundGuard,
  parseBuildFlavor,
  resolveProfileForProtectedView,
  type OutboundGuardMode,
} from '../src/agent/outbound/outboundGate.ts'
import { parsePolicySourceMode } from '../src/agent/outbound/policySourceMode.ts'
import { resolvePolicyDir, ensureLocalPolicyTree } from '../src/agent/outbound/policyStore.ts'
import { connectionIdForBuiltinLlm } from '../src/agent/outbound/providerConnectionId.ts'
import {
  createSanitizedWorkspace,
  disposeSanitizedWorkspace,
  type SanitizedWorkspace,
} from '../src/agent/outbound/sanitizedWorkspace.ts'
import {
  appendEvidenceRecord,
  type AppendEvidenceInput,
  type HmacKeyProvider,
} from '../src/agent/outbound/evidenceLedger.ts'
import { BUILTIN_BASELINE_POLICY, emptySupplementalPolicy } from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import { formatProviderPolicyStatus } from '../src/agent/outbound/policyStatus.ts'

const runViews = new Map<string, SanitizedWorkspace>()

function envMap(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>
}

export function outboundPolicyDir(): string {
  return resolvePolicyDir(envMap(), app.getPath('userData'))
}

export function outboundLedgerDir(): string {
  return path.join(app.getPath('userData'), 'outbound-evidence')
}

function hmacKeyPath(): string {
  return path.join(app.getPath('userData'), 'outbound-evidence.hmac')
}

/** Per-device HMAC key via safeStorage when available; else ephemeral memory for demo. */
export function getEvidenceHmacKeyProvider(): HmacKeyProvider {
  return {
    async getKey() {
      const p = hmacKeyPath()
      try {
        if (safeStorage.isEncryptionAvailable()) {
          if (fs.existsSync(p)) {
            const enc = fs.readFileSync(p)
            const raw = safeStorage.decryptString(enc)
            return Buffer.from(raw, 'base64')
          }
          const key = Buffer.from(
            Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
          )
          fs.writeFileSync(p, safeStorage.encryptString(key.toString('base64')))
          return key
        }
      } catch {
        /* fall through */
      }
      // demo / unsealed environments
      return Buffer.from('demo-unsealed-outbound-hmac-key!!')
    },
  }
}

export type OutboundStatusSnapshot = {
  deployGuard: OutboundGuardMode | 'invalid'
  deployGuardError?: string
  policySource: 'local' | 'workspace' | 'invalid'
  policySourceError?: string
  buildFlavor: 'standard' | 'policy-admin' | 'invalid'
  buildFlavorError?: string
  policyDir: string
  ledgerDir: string
  encryptionAvailable: boolean
  connectionId?: string
  policySummary?: string
  activeViews: number
}

export function getOutboundStatus(opts?: {
  apiProvider?: string
  baseUrl?: string
}): OutboundStatusSnapshot {
  let deployGuard: OutboundGuardMode | 'invalid' = 'off'
  let deployGuardError: string | undefined
  try {
    deployGuard = parseDeployOutboundGuard(process.env.SUBAGENTS_OUTBOUND_GUARD)
  } catch (e) {
    deployGuard = 'invalid'
    deployGuardError = e instanceof Error ? e.message : String(e)
  }

  let policySource: 'local' | 'workspace' | 'invalid' = 'local'
  let policySourceError: string | undefined
  try {
    policySource = parsePolicySourceMode(process.env.SUBAGENTS_POLICY_SOURCE)
  } catch (e) {
    policySource = 'invalid'
    policySourceError = e instanceof Error ? e.message : String(e)
  }

  let buildFlavor: 'standard' | 'policy-admin' | 'invalid' = 'standard'
  let buildFlavorError: string | undefined
  try {
    buildFlavor = parseBuildFlavor(process.env.SUBAGENTS_BUILD_FLAVOR)
  } catch (e) {
    buildFlavor = 'invalid'
    buildFlavorError = e instanceof Error ? e.message : String(e)
  }

  const connectionId =
    opts?.apiProvider || opts?.baseUrl
      ? connectionIdForBuiltinLlm({
          apiProvider: opts.apiProvider || 'custom',
          baseUrl: opts.baseUrl || '',
        })
      : undefined

  let policySummary: string | undefined
  if (connectionId) {
    try {
      // best-effort sync read of compiled status after ensure
      policySummary = formatProviderPolicyStatus({
        connectionId,
        policySource: policySource === 'invalid' ? 'local' : policySource,
        profile: null,
        error: null,
      }).summary
    } catch {
      /* ignore */
    }
  }

  return {
    deployGuard,
    deployGuardError,
    policySource,
    policySourceError,
    buildFlavor,
    buildFlavorError,
    policyDir: outboundPolicyDir(),
    ledgerDir: outboundLedgerDir(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    connectionId,
    policySummary,
    activeViews: runViews.size,
  }
}

export async function ensureOutboundPolicy(connectionId: string) {
  const dir = outboundPolicyDir()
  return ensureLocalPolicyTree(dir, connectionId)
}

export async function prepareOutboundRunView(opts: {
  runId: string
  projectRoot: string
  apiProvider?: string
  baseUrl?: string
  connectionId?: string
  /** Effective outbound guard mode — required fails closed on policy load (ticket 17). */
  effectiveMode?: OutboundGuardMode
}): Promise<
  | {
      ok: true
      viewRoot: string
      connectionId: string
      exclusionCount: number
      skippedCount: number
      profileDegraded?: boolean
    }
  | { ok: false; reason: string }
> {
  const runId = String(opts.runId || '').trim()
  const projectRoot = String(opts.projectRoot || '').trim()
  if (!runId || !projectRoot) {
    return { ok: false, reason: 'runId and projectRoot required' }
  }
  if (!fs.existsSync(projectRoot)) {
    return { ok: false, reason: 'projectRoot not found' }
  }

  // Dispose previous view for this run if any
  const prev = runViews.get(runId)
  if (prev) {
    await disposeSanitizedWorkspace(prev)
    runViews.delete(runId)
  }

  const connectionId =
    opts.connectionId ||
    connectionIdForBuiltinLlm({
      apiProvider: opts.apiProvider || 'custom',
      baseUrl: opts.baseUrl || '',
    })

  const effectiveMode: OutboundGuardMode = opts.effectiveMode || 'optional'
  const ensured = await ensureLocalPolicyTree(outboundPolicyDir(), connectionId)
  const profileDecision = resolveProfileForProtectedView({
    effectiveMode,
    ensureOk: ensured.ok,
    ensureReason: ensured.ok ? undefined : ensured.reason,
  })
  if (profileDecision.action === 'block') {
    return { ok: false, reason: profileDecision.reason }
  }

  let profile = compileProviderSecurityProfile(
    BUILTIN_BASELINE_POLICY,
    emptySupplementalPolicy(connectionId),
  )
  let profileDegraded = false
  if (profileDecision.action === 'use-ensured' && ensured.ok) {
    profile = ensured.profile
  } else if (profileDecision.action === 'use-baseline') {
    profileDegraded = true
  }

  try {
    const ws = await createSanitizedWorkspace({
      connectionId,
      projectRoot,
      profile,
      baseDir: path.join(app.getPath('temp'), 'subagents-sanitized'),
    })
    runViews.set(runId, ws)
    return {
      ok: true,
      viewRoot: ws.viewRoot,
      connectionId,
      exclusionCount: ws.exclusions.length,
      skippedCount: ws.skipped.length,
      profileDegraded: profileDegraded || undefined,
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function disposeOutboundRunView(runId: string): Promise<{ ok: boolean }> {
  const ws = runViews.get(runId)
  if (!ws) return { ok: true }
  await disposeSanitizedWorkspace(ws)
  runViews.delete(runId)
  return { ok: true }
}

export function getOutboundRunViewRoot(runId: string): string | null {
  return runViews.get(runId)?.viewRoot || null
}

export function getOutboundRunViewMeta(runId: string): {
  viewRoot: string
  originalRoot: string
  connectionId: string
} | null {
  const ws = runViews.get(runId)
  if (!ws) return null
  return {
    viewRoot: ws.viewRoot,
    originalRoot: ws.originalRoot,
    connectionId: ws.connectionId,
  }
}

export async function appendOutboundEvidence(
  input: AppendEvidenceInput,
  opts?: { sealed?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  const mode = (() => {
    try {
      return parseDeployOutboundGuard(process.env.SUBAGENTS_OUTBOUND_GUARD)
    } catch {
      return 'off' as const
    }
  })()
  const sealed =
    opts?.sealed ??
    (mode === 'required' && safeStorage.isEncryptionAvailable())
  const r = await appendEvidenceRecord(input, {
    ledgerDir: outboundLedgerDir(),
    keyProvider: getEvidenceHmacKeyProvider(),
    sealed,
  })
  if (!r.ok) return { ok: false, reason: r.reason }
  return { ok: true }
}
