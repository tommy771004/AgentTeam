/**
 * Run a one-shot agent prompt via local CLI binaries (Codex / Claude / Grok / OpenCode / Cursor).
 * Uses existing shell auth — does not re-implement OAuth.
 */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runBash } from './shellBridge'
import { resolveCliApproval } from '../src/agent/cliApproval'

export type LocalCliKind = 'codex' | 'claude' | 'grok' | 'opencode' | 'cursor'
export type CliApprovalMode = 'always' | 'auto' | 'full'

export type LocalCliRunInput = {
  kind: LocalCliKind
  /** Absolute path or command name */
  binary?: string
  prompt: string
  cwd?: string
  model?: string
  /** App thinking depth → vendor effort */
  depth?: string
  /** build | plan */
  agentMode?: string
  /** App-level approval policy, mapped only where the target CLI supports it. */
  approvalMode?: CliApprovalMode
  /** Automation must never receive permissive CLI flags. */
  unattended?: boolean
  timeoutMs?: number
  runId?: string
}

export type LocalCliRunResult = {
  ok: boolean
  output: string
  command: string
  kind: LocalCliKind
  code: number | null
  timedOut?: boolean
  cancelled?: boolean
  error?: string
  runId?: string
}

function shellQuote(s: string): string {
  if (process.platform === 'win32') {
    // cmd.exe needs double quotes; POSIX single quotes become literal characters
    // and make `"'C:\\Program Files\\…'"` fail to launch.
    return `"${s
      .replace(/%/g, '%%')
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/g, '$1$1')}"`
  }
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function depthToCodexEffort(depth?: string): string {
  switch (depth) {
    case 'fast':
      return 'low'
    case 'standard':
      return 'medium'
    case 'deep':
      return 'high'
    case 'max':
      return 'xhigh'
    case 'ultra':
      return 'max'
    default:
      return 'high'
  }
}

export function resolveBinary(kind: LocalCliKind, binary?: string): string {
  if (binary && binary.trim()) return binary.trim()
  switch (kind) {
    case 'claude':
      return 'claude'
    case 'codex':
      return 'codex'
    case 'grok':
      return 'grok'
    case 'opencode':
      return 'opencode'
    case 'cursor':
      return 'cursor-agent'
    default:
      return kind
  }
}

/**
 * Build vendor CLI one-shot command (best-effort flags; may vary by version).
 */
export function buildLocalCliCommand(input: LocalCliRunInput): string {
  const bin = resolveBinary(input.kind, input.binary)
  const prompt = input.prompt.slice(0, 12000)
  const q = shellQuote(prompt)
  const model = input.model?.trim()
  const effort = depthToCodexEffort(input.depth)
  const plan = input.agentMode === 'plan'
  const approval = resolveCliApproval(
    input.kind,
    input.approvalMode,
    input.unattended,
    input.agentMode,
  )
  const binQ = shellQuote(bin)

  switch (input.kind) {
    case 'codex': {
      const modelFlag = model ? `--model ${shellQuote(model)}` : ''
      const effortFlag = `--config model_reasoning_effort=${shellQuote(effort)}`
      const perm = approval.permissive ? '--full-auto' : ''
      return [
        `${binQ} exec ${perm} ${modelFlag} ${effortFlag} ${q}`,
        `${binQ} ${perm} ${modelFlag} -q ${q}`,
        // A legacy CLI may not know --full-auto. Safe fallback is intentional:
        // it can reduce permissions but must never silently retain them.
        `${binQ} ${modelFlag} ${q}`,
      ]
        .map((c) => `(${c})`)
        .join(' || ')
    }
    case 'claude': {
      const modelFlag = model ? `--model ${shellQuote(model)}` : ''
      const perm = plan
        ? '--permission-mode plan'
        : approval.permissive
          ? '--dangerously-skip-permissions'
          : ''
      const safeFallback = approval.permissive
        ? ` || ${binQ} -p ${modelFlag} ${q}`
        : ''
      return `${binQ} -p ${modelFlag} ${perm} ${q}${safeFallback}`
    }
    case 'grok': {
      const modelFlag = model ? `--model ${shellQuote(model)}` : ''
      return `${binQ} ${modelFlag} ${q}`
    }
    case 'opencode': {
      const modelFlag = model ? `--model ${shellQuote(model)}` : ''
      return [`${binQ} run ${modelFlag} ${q}`, `${binQ} ${q}`]
        .map((c) => `(${c})`)
        .join(' || ')
    }
    case 'cursor': {
      // cursor-agent: try print-style then bare prompt
      return [`${binQ} -p ${q}`, `${binQ} ${q}`].map((c) => `(${c})`).join(' || ')
    }
    default:
      return `${binQ} ${q}`
  }
}

async function preflightBinary(
  kind: LocalCliKind,
  binary: string,
): Promise<{ ok: boolean; path: string | null; error?: string }> {
  // Absolute path: just check exists via shell test
  if (path.isAbsolute(binary)) {
    const r = await runBash({
      command:
        process.platform === 'win32'
          ? `if exist ${shellQuote(binary)} (echo OK) else (exit 1)`
          : `test -x ${shellQuote(binary)} || test -f ${shellQuote(binary)}`,
      timeoutMs: 5000,
      tag: 'cli-preflight',
    })
    if (!r.ok) {
      return {
        ok: false,
        path: null,
        error: `找不到可執行檔：${binary}（請在設定中授權並掃描 CLI，或安裝 ${kind}）`,
      }
    }
    return { ok: true, path: binary }
  }

  const r = await runBash({
    command:
      process.platform === 'win32' ? `where ${binary}` : `command -v ${shellQuote(binary)}`,
    timeoutMs: 5000,
    tag: 'cli-preflight',
  })
  const found = r.stdout.trim().split(/\r?\n/)[0] || null
  if (!r.ok || !found) {
    return {
      ok: false,
      path: null,
      error: `PATH 中找不到 \`${binary}\`（kind=${kind}）。請安裝 CLI、確認 PATH，並在設定 → 掃描本機 CLI。`,
    }
  }
  return { ok: true, path: found }
}

export async function runLocalCliAgent(input: LocalCliRunInput): Promise<LocalCliRunResult> {
  const kind = input.kind
  const bin = resolveBinary(kind, input.binary)
  const runId = input.runId || randomUUID()
  const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : undefined
  const timeoutMs = input.timeoutMs || 300_000

  const pre = await preflightBinary(kind, bin)
  if (!pre.ok) {
    return {
      ok: false,
      output: '',
      command: bin,
      kind,
      code: 127,
      error: pre.error,
      runId,
    }
  }

  const command = buildLocalCliCommand({
    ...input,
    binary: pre.path || bin,
  })

  const r = await runBash({
    command,
    cwd,
    timeoutMs,
    runId,
    tag: 'cli-agent',
  })

  const output = [r.stdout, r.stderr].filter(Boolean).join('\n\n').trim()
  const cancelled = Boolean(r.cancelled)
  return {
    ok: r.ok,
    output:
      output.slice(0, 100_000) ||
      (r.ok ? '(empty output)' : cancelled ? '已取消' : 'CLI 無輸出'),
    command,
    kind,
    code: r.code,
    timedOut: r.timedOut,
    cancelled,
    error: r.ok
      ? undefined
      : cancelled
        ? '使用者取消'
        : r.timedOut
          ? '逾時'
          : r.stderr || `exit ${r.code}`,
    runId,
  }
}
