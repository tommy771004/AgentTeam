/**
 * Run a one-shot agent prompt via local CLI binaries (Codex / Claude / Grok / OpenCode / Cursor).
 * Uses existing shell auth — does not re-implement OAuth.
 *
 * Chat attachments are materialized to disk under `.subagents/chat-attachments/<runId>/`
 * and absolute paths are injected into the prompt so CLIs can open/read/vision them.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runBash } from './shellBridge'
import {
  executableLookupCommand,
  firstExecutablePath,
  quoteShellArg,
} from './platformProcess'
import { resolveCliApproval } from '../src/agent/cliApproval'
import { materializeAttachments } from './attachmentStore'

export type LocalCliKind = 'codex' | 'claude' | 'grok' | 'opencode' | 'cursor'
export type CliApprovalMode = 'always' | 'auto' | 'full'

/** Serializable chat attachment from renderer (images as data URL) */
export type LocalCliAttachment = {
  name: string
  mimeType?: string
  kind?: 'image' | 'text' | 'binary'
  dataUrl?: string
  textContent?: string
}

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
  /** User chat attachments — written to disk for CLI vision/file tools */
  attachments?: LocalCliAttachment[]
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
 * Write attachments to disk and return prompt block + absolute paths.
 */
export function materializeCliAttachments(
  attachments: LocalCliAttachment[] | undefined,
  cwd: string | undefined,
  runId: string,
): { dir: string | null; paths: string[]; promptBlock: string } {
  if (!attachments?.length) {
    return { dir: null, paths: [], promptBlock: '' }
  }

  const { dir, items } = materializeAttachments(attachments, {
    projectRoot: cwd,
    sessionId: runId,
  })

  const paths: string[] = []
  const lines: string[] = [
    '## User attachments (local files)',
    'The following files were saved for this run. Read them with your file/vision tools.',
    'Images: open the absolute path and describe/analyze visually when the task requires it.',
    '',
  ]

  for (const att of items) {
    if (att.filePath) {
      paths.push(att.filePath)
      const kind =
        att.kind ||
        (att.dataUrl ? 'image' : att.textContent != null ? 'text' : 'binary')
      lines.push(`- [${kind}] ${att.filePath}`)
      lines.push(`  ref: @${att.filePath}`)
    } else {
      lines.push(`- (skipped, no payload) ${att.name}`)
    }
  }

  if (!paths.length) {
    return { dir, paths: [], promptBlock: lines.join('\n') }
  }

  lines.push('')
  lines.push(
    'When analyzing images, use the absolute paths above (do not invent file contents).',
  )
  return { dir, paths, promptBlock: lines.join('\n') }
}


/**
 * Build vendor CLI one-shot command (best-effort flags; may vary by version).
 */
export function buildLocalCliCommand(input: LocalCliRunInput): string {
  const bin = resolveBinary(input.kind, input.binary)
  // Paths + user goal; allow more room when attachments are inlined as paths
  const maxPrompt = input.attachments?.length ? 24_000 : 12_000
  const prompt = input.prompt.slice(0, maxPrompt)
  const q = quoteShellArg(prompt)
  const model = input.model?.trim()
  const effort = depthToCodexEffort(input.depth)
  const plan = input.agentMode === 'plan'
  const approval = resolveCliApproval(
    input.kind,
    input.approvalMode,
    input.unattended,
    input.agentMode,
  )
  const binQ = quoteShellArg(bin)

  switch (input.kind) {
    case 'codex': {
      const modelFlag = model ? `--model ${quoteShellArg(model)}` : ''
      const effortFlag = `--config model_reasoning_effort=${quoteShellArg(effort)}`
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
      const modelFlag = model ? `--model ${quoteShellArg(model)}` : ''
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
      const modelFlag = model ? `--model ${quoteShellArg(model)}` : ''
      return `${binQ} ${modelFlag} ${q}`
    }
    case 'opencode': {
      const modelFlag = model ? `--model ${quoteShellArg(model)}` : ''
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
  // Absolute paths are checked with Node APIs so separators and spaces retain
  // their native meaning on both Windows and macOS.
  if (path.isAbsolute(binary)) {
    let exists = false
    try {
      exists = fs.statSync(binary).isFile()
    } catch {
      exists = false
    }
    if (!exists) {
      return {
        ok: false,
        path: null,
        error: `找不到可執行檔：${binary}（請在設定中授權並掃描 CLI，或安裝 ${kind}）`,
      }
    }
    return { ok: true, path: binary }
  }

  const r = await runBash({
    command: executableLookupCommand(binary),
    timeoutMs: 5000,
    tag: 'cli-preflight',
  })
  const found = firstExecutablePath(r.stdout)
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

  // Materialize chat attachments so CLI tools/vision can open real files
  const materialized = materializeCliAttachments(input.attachments, cwd, runId)
  let prompt = input.prompt
  if (materialized.promptBlock) {
    prompt = `${prompt.trim()}\n\n${materialized.promptBlock}`.trim()
  }

  const command = buildLocalCliCommand({
    ...input,
    prompt,
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
  const attachNote =
    materialized.paths.length > 0
      ? `\n\n[attachments: ${materialized.paths.length} file(s) under ${materialized.dir}]`
      : ''
  return {
    ok: r.ok,
    output:
      (output.slice(0, 100_000) ||
        (r.ok ? '(empty output)' : cancelled ? '已取消' : 'CLI 無輸出')) +
      (r.ok ? '' : attachNote),
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
