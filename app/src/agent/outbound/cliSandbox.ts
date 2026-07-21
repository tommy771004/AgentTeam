/**
 * Filesystem sandbox gate for external CLI under Outbound Data Guard.
 * Required mode needs verified isolation; optional/demo may run unverified with a mark.
 * Ticket 20: main re-applies decideMainCliSpawnAdmission so renderer cannot omit wrap.
 */

import os from 'node:os'
import path from 'node:path'
import type { OutboundGuardMode } from './outboundGate.ts'

export type FilesystemIsolationStatus = 'verified' | 'unverified' | 'unavailable'

export type CliSandboxDecision = {
  allow: boolean
  /** Status recorded in evidence / UI (never includes paths with secrets). */
  isolationStatus: FilesystemIsolationStatus
  isolationVerified: boolean
  /** Non-sensitive reason when blocked or degraded. */
  reason?: string
}

/**
 * Decide whether an external CLI process may start.
 * Does not create the sandbox — only enforces the policy on reported capability.
 */
export function evaluateCliSandboxGate(opts: {
  effectiveMode: OutboundGuardMode
  isolationStatus: FilesystemIsolationStatus
}): CliSandboxDecision {
  const { effectiveMode, isolationStatus } = opts

  if (effectiveMode === 'off') {
    return {
      allow: true,
      isolationStatus,
      isolationVerified: false,
    }
  }

  if (effectiveMode === 'required') {
    if (isolationStatus === 'verified') {
      return {
        allow: true,
        isolationStatus: 'verified',
        isolationVerified: true,
      }
    }
    return {
      allow: false,
      isolationStatus,
      isolationVerified: false,
      reason:
        isolationStatus === 'unavailable'
          ? 'Required 模式需要已驗證的 filesystem sandbox；目前環境不可用。已停用 external CLI；sanitized 直接 LLM 仍可使用。'
          : 'Required 模式拒絕未驗證的 filesystem isolation。已停用 external CLI。',
    }
  }

  // optional / demo — may run with sanitized cwd only; mark unverified
  const status: FilesystemIsolationStatus =
    isolationStatus === 'verified' ? 'verified' : isolationStatus === 'unavailable' ? 'unavailable' : 'unverified'
  if (status === 'unavailable') {
    return {
      allow: false,
      isolationStatus: 'unavailable',
      isolationVerified: false,
      reason: 'External CLI 需要 filesystem 能力；目前不可用。',
    }
  }
  return {
    allow: true,
    isolationStatus: status,
    isolationVerified: status === 'verified',
    reason:
      status === 'unverified'
        ? 'Filesystem isolation unverified（demo/optional 允許，但不得宣稱企業邊界）。'
        : undefined,
  }
}

/**
 * Probe whether a verified sandbox adapter is present (Electron).
 * Pure Node smoke uses explicit status injection; production prefers async probe result.
 */
export function detectFilesystemSandboxCapability(opts?: {
  hasSandboxAdapter?: boolean
  /** Result from main `outbound:sandboxProbe` when available. */
  probeStatus?: FilesystemIsolationStatus
}): FilesystemIsolationStatus {
  if (opts?.probeStatus) return opts.probeStatus
  if (opts?.hasSandboxAdapter === true) return 'verified'
  if (opts?.hasSandboxAdapter === false) return 'unavailable'
  try {
    const w = globalThis as typeof globalThis & {
      window?: {
        subagents?: {
          outbound?: { sandboxProbe?: unknown }
          cli?: { runAgent?: unknown }
        }
      }
    }
    const sub = w.window?.subagents
    if (sub?.outbound?.sandboxProbe) {
      // Sync path cannot await — treat as unverified until async probe fills in.
      return 'unverified'
    }
    if (sub?.cli?.runAgent) {
      return 'unverified'
    }
  } catch {
    /* ignore */
  }
  return 'unavailable'
}

export type SandboxProbeClientResult = {
  status: FilesystemIsolationStatus
  engine?: 'seatbelt' | 'bwrap' | 'none'
  detail?: string
}

/**
 * Async probe via Electron main (seatbelt/bwrap verification).
 * Callers under required guard must await this before process creation.
 */
export async function probeFilesystemSandbox(opts: {
  viewRoot: string
  forbiddenCanaryPath: string
}): Promise<SandboxProbeClientResult> {
  try {
    const w = globalThis as typeof globalThis & {
      window?: {
        subagents?: {
          outbound?: {
            sandboxProbe?: (o: {
              viewRoot: string
              forbiddenCanaryPath: string
            }) => Promise<SandboxProbeClientResult>
          }
        }
      }
    }
    const r = await w.window?.subagents?.outbound?.sandboxProbe?.(opts)
    if (r?.status === 'verified' || r?.status === 'unverified' || r?.status === 'unavailable') {
      return {
        status: r.status,
        engine: r.engine,
        detail: r.detail,
      }
    }
  } catch {
    /* ignore */
  }
  return { status: detectFilesystemSandboxCapability() }
}

/**
 * Rewrite absolute original project paths in CLI prompts to the sanitized view root.
 * Does not claim to catch all escape paths — process sandbox is still required for required mode.
 */
export function rewriteCliPromptForView(
  prompt: string,
  roots: { originalRoot: string; viewRoot: string },
): string {
  const orig = roots.originalRoot.replace(/\/+$/, '')
  const view = roots.viewRoot.replace(/\/+$/, '')
  if (!orig || !view) return prompt
  // Escape for RegExp
  const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return prompt.replace(new RegExp(esc, 'g'), view)
}

/** True if `target` is `root` or a path under it (resolved). */
export function isPathInsideRoot(target: string, root: string): boolean {
  const t = path.resolve(target)
  const r = path.resolve(root)
  if (t === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return t.startsWith(prefix)
}

/**
 * Forbidden canary for sandbox probes — never under original project or view.
 * (ADR-0007: constructing the view must not pollute the original tree.)
 */
export function allocateForbiddenCanaryPath(opts?: {
  originalRoot?: string
  viewRoot?: string
  tmpDir?: string
}): string {
  const base = opts?.tmpDir || os.tmpdir()
  // Deterministic path shape for tests; main/verify may create the file.
  const dir = path.join(base, `subagents-forbid-${process.pid}`)
  const p = path.join(dir, 'canary')
  if (opts?.originalRoot && isPathInsideRoot(p, opts.originalRoot)) {
    throw new Error('canary path resolved inside original project')
  }
  if (opts?.viewRoot && isPathInsideRoot(p, opts.viewRoot)) {
    throw new Error('canary path resolved inside Restricted Project View')
  }
  return p
}

export type MainCliSpawnAdmission = {
  allow: boolean
  isolationVerified: boolean
  isolationStatus: FilesystemIsolationStatus
  reason?: string
}

/**
 * Main-process spawn gate (ticket 20). Renderer-supplied isolationStatus is only
 * trusted when paired with a matching sandboxWrap; required mode demands both
 * wrap and verified isolation, and cwd must sit inside the bound view.
 */
export function decideMainCliSpawnAdmission(opts: {
  effectiveMode: OutboundGuardMode
  cwd: string
  boundViewRoot?: string | null
  sandboxWrap?: { engine: string; viewRoot: string } | null
  /** Main-probed status when wrap present; never trust renderer-only claims under required. */
  isolationStatus: FilesystemIsolationStatus
}): MainCliSpawnAdmission {
  const { effectiveMode, isolationStatus } = opts
  const wrap = opts.sandboxWrap
  const bound = (opts.boundViewRoot || '').trim()
  const wrapView = (wrap?.viewRoot || '').trim()
  const cwd = (opts.cwd || '').trim() || '.'

  if (effectiveMode === 'off') {
    return {
      allow: true,
      isolationVerified: false,
      isolationStatus,
    }
  }

  if (effectiveMode === 'required') {
    if (!wrap || (wrap.engine !== 'seatbelt' && wrap.engine !== 'bwrap') || !wrapView) {
      return {
        allow: false,
        isolationVerified: false,
        isolationStatus: isolationStatus === 'verified' ? 'unverified' : isolationStatus,
        reason:
          'Required 模式拒絕未附 sandbox wrap 的 CLI spawn（main 強制；renderer 不可省略）。',
      }
    }
    if (bound && path.resolve(bound) !== path.resolve(wrapView)) {
      return {
        allow: false,
        isolationVerified: false,
        isolationStatus: 'unverified',
        reason: 'sandbox wrap viewRoot 與 run 綁定的 Restricted Project View 不一致。',
      }
    }
    const viewForCwd = bound || wrapView
    if (!isPathInsideRoot(cwd, viewForCwd)) {
      return {
        allow: false,
        isolationVerified: false,
        isolationStatus: 'unverified',
        reason: 'CLI cwd 必須位於 Restricted Project View 內。',
      }
    }
    if (isolationStatus !== 'verified') {
      return {
        allow: false,
        isolationVerified: false,
        isolationStatus,
        reason:
          isolationStatus === 'unavailable'
            ? 'Required 模式需要 main 已驗證的 filesystem sandbox；目前環境不可用。'
            : 'Required 模式拒絕未經驗證的 filesystem isolation（main 重驗）。',
      }
    }
    return {
      allow: true,
      isolationVerified: true,
      isolationStatus: 'verified',
    }
  }

  // optional / demo — may run without wrap; mark unverified
  const gate = evaluateCliSandboxGate({ effectiveMode, isolationStatus })
  return {
    allow: gate.allow,
    isolationVerified: gate.isolationVerified,
    isolationStatus: gate.isolationStatus,
    reason: gate.reason,
  }
}
