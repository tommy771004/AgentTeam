/**
 * Local policy filesystem store (Electron main / Node).
 * Never under project tree or renderer localStorage.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
  validateCompanyBasePolicy,
  validateProviderSupplementalPolicy,
  type CompanyBasePolicy,
  type ProviderSupplementalPolicy,
} from './policySchema.ts'
import { compileProviderSecurityProfile, type ProviderSecurityProfile } from './policyMerge.ts'
import type { PolicySourceMode } from './policySourceMode.ts'

export type { PolicySourceMode }
export { parsePolicySourceMode } from './policySourceMode.ts'

export function resolvePolicyDir(
  env: Record<string, string | undefined>,
  userDataPath: string,
): string {
  const override = (env.SUBAGENTS_OUTBOUND_POLICY_DIR || '').trim()
  if (override) return path.resolve(override)
  return path.join(userDataPath, 'outbound-policy')
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

function readJsonFile(filePath: string): unknown {
  const text = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(text)
}

export type ProfileLoadResult =
  | { ok: true; profile: ProviderSecurityProfile; policySource: PolicySourceMode }
  | { ok: false; reason: string; connectionId: string }

/**
 * Ensure company-base + empty supplement exist; return compiled profile.
 * Existing malformed files are never overwritten here.
 */
export async function ensureLocalPolicyTree(
  policyDir: string,
  connectionId: string,
): Promise<ProfileLoadResult> {
  fs.mkdirSync(path.join(policyDir, 'providers'), { recursive: true })
  const basePath = path.join(policyDir, 'company-base.json')
  const suppPath = path.join(policyDir, 'providers', connectionFileName(connectionId))

  if (!fs.existsSync(basePath)) {
    writeJsonAtomic(basePath, BUILTIN_BASELINE_POLICY)
  }
  if (!fs.existsSync(suppPath)) {
    writeJsonAtomic(suppPath, emptySupplementalPolicy(connectionId))
  }

  return loadProviderSecurityProfile({
    policyDir,
    connectionId,
    policySource: 'local',
  })
}

export async function loadProviderSecurityProfile(opts: {
  policyDir: string
  connectionId: string
  policySource: PolicySourceMode
}): Promise<ProfileLoadResult> {
  const { policyDir, connectionId, policySource } = opts
  if (policySource === 'workspace') {
    // Ticket 10 — workspace bundle sync. Local load path rejects for now.
    return {
      ok: false,
      connectionId,
      reason: 'workspace policy source not yet synced (use local or wait for ticket 10)',
    }
  }

  const basePath = path.join(policyDir, 'company-base.json')
  const suppPath = path.join(policyDir, 'providers', connectionFileName(connectionId))

  let base: CompanyBasePolicy
  let supplement: ProviderSupplementalPolicy
  try {
    if (!fs.existsSync(basePath)) {
      return {
        ok: false,
        connectionId,
        reason: 'missing company-base policy (call ensureLocalPolicyTree first)',
      }
    }
    base = validateCompanyBasePolicy(readJsonFile(basePath))
  } catch (e) {
    return {
      ok: false,
      connectionId,
      reason: `malformed company-base policy: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  try {
    if (!fs.existsSync(suppPath)) {
      return {
        ok: false,
        connectionId,
        reason: 'missing provider supplement (call ensureLocalPolicyTree first)',
      }
    }
    supplement = validateProviderSupplementalPolicy(readJsonFile(suppPath))
    if (supplement.connectionId !== connectionId) {
      return {
        ok: false,
        connectionId,
        reason: `provider supplement connectionId mismatch (file=${supplement.connectionId})`,
      }
    }
  } catch (e) {
    return {
      ok: false,
      connectionId,
      reason: `malformed provider supplement: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  try {
    const profile = compileProviderSecurityProfile(base, supplement)
    return { ok: true, profile, policySource }
  } catch (e) {
    return {
      ok: false,
      connectionId,
      reason: `policy merge failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
