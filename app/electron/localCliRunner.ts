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
import { cancelBashAndWait, runArgv, runBash, writeRunStdin, type BashResult } from './shellBridge.ts'
import {
  executableLookupCommand,
  firstExecutablePath,
  quoteShellArg,
} from './platformProcess.ts'
import { resolveCliApproval } from '../src/agent/cliApproval.ts'
import { materializeAttachments } from './attachmentStore.ts'
import { wrapCommandInSandbox } from './cliFilesystemSandbox.ts'
import type { CliConfigSnapshot, ExternalRunRef } from '../src/agent/types.ts'
import { redactCliDisplayArgs, redactCliTelemetryText } from '../src/agent/cliCommandTelemetry.ts'
import { externalLifecycleToStream } from '../src/agent/externalCliLifecycleProjection.ts'
import {
  ExternalCliRunSession,
  classifyExternalCliDiagnostic,
  formatExternalCliTerminal,
  normalizeExternalCliRunPolicy,
  type ExternalCliConnectorRequirement,
  type ExternalCliClock,
  type ExternalCliRunPhase,
  type ExternalCliTerminalClassification,
  type ExternalCliRunPolicy,
} from '../src/agent/externalCliRunSession.ts'
import {
  cancelExternalCliSession as cancelSupervisedExternalCliSession,
  externalCliSupervisor,
  getExternalCliSession as getSupervisedExternalCliSession,
  interruptExternalCliSessions as interruptSupervisedExternalCliSessions,
} from './externalCliSupervisor.ts'

export type LocalCliKind = 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini' | 'cursor'
export type CliApprovalMode = 'always' | 'auto' | 'full'

/** Serializable chat attachment from renderer (images as data URL) */
export type LocalCliAttachment = {
  name: string
  mimeType?: string
  kind?: 'image' | 'text' | 'binary'
  dataUrl?: string
  textContent?: string
  filePath?: string
}

/** 任務清單項目（TodoWrite / update_plan / todo_list）→ 右側面板同步 */
export type LocalCliPlanItem = {
  text: string
  status: 'pending' | 'active' | 'done'
}

/** Live stream event pushed to renderer during CLI run */
export type LocalCliStreamEvent = {
  runId: string
  kind: 'status' | 'thought' | 'text' | 'tool' | 'file' | 'log' | 'error' | 'done' | 'chunk' | 'plan'
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  delta?: string
  channel?: 'thought' | 'text' | 'stdout' | 'stderr'
  path?: string
  paths?: string[]
  added?: number
  removed?: number
  action?: 'edit' | 'create' | 'delete' | 'write' | 'read'
  /** kind=plan 時的完整任務清單快照 */
  todos?: LocalCliPlanItem[]
  /** Durable External CLI Run Session cursor and phase. */
  sequence?: number
  sessionPhase?: ExternalCliRunPhase
  terminalClassification?: ExternalCliTerminalClassification
  providerSessionId?: string
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
  /** Provider-specific reasoning variant, when explicitly configured. */
  thinkingVariant?: string
  /** Ask OpenCode to include reasoning blocks in its JSON stream. */
  showThinking?: boolean
  /** build | plan */
  agentMode?: string
  /** App-level approval policy, mapped only where the target CLI supports it. */
  approvalMode?: CliApprovalMode
  /** Automation must never receive permissive CLI flags. */
  unattended?: boolean
  conversationId?: string
  /** Immutable Host supervision policy; timeoutMs is operation-scoped only. */
  externalCliPolicy?: Partial<ExternalCliRunPolicy>
  requiredConnectors?: ExternalCliConnectorRequirement[]
  timeoutMs?: number
  runId?: string
  /** Safe OpenCode config lineage captured before dispatch. */
  configSnapshot?: CliConfigSnapshot
  /** User chat attachments — written to disk for CLI vision/file tools */
  attachments?: LocalCliAttachment[]
  /** Internal materialized paths; OpenCode consumes these through --file. */
  attachmentPaths?: string[]
  /** Live NDJSON / chunk callback for center process feed */
  onStream?: (ev: LocalCliStreamEvent) => void
  /**
   * When set, wrap the CLI process under a verified OS filesystem sandbox
   * (seatbelt / bwrap) with viewRoot as the only writable project tree.
   */
  sandboxWrap?: {
    engine: 'seatbelt' | 'bwrap'
    viewRoot: string
  }
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
  configSnapshot?: CliConfigSnapshot
  externalRun?: ExternalRunRef
  terminalClassification?: ExternalCliTerminalClassification
}

/** Injectable only at the shipped process boundary; production defaults to shellBridge. */
export type LocalCliRunDependencies = {
  runArgv?: (input: Parameters<typeof runArgv>[0]) => Promise<BashResult>
  cancelRun?: (runId: string) => Promise<{ confirmed: boolean; detail?: string }>
  writeInput?: (runId: string, value: string) => boolean
  clock?: ExternalCliClock
}

/** Main-process registry; renderer never owns canonical session state. */
export const externalCliSessions = externalCliSupervisor

export async function cancelExternalCliSession(runId: string): Promise<{
  ok: boolean
  classification?: ExternalCliTerminalClassification
  confirmed?: boolean
}> {
  const session = getSupervisedExternalCliSession(runId)
  if (!session) return { ok: false }
  const settlement = await cancelSupervisedExternalCliSession(runId)
  return {
    ok: settlement.classification === 'user-cancelled' && settlement.terminationConfirmed === true,
    classification: settlement.classification,
    confirmed: settlement.terminationConfirmed === true,
  }
}

export function getExternalCliSession(runId: string) {
  return getSupervisedExternalCliSession(runId)
}

/** Return only live Host sessions for renderer projection rebuild after reload. */
export function listActiveExternalCliSessions() {
  return externalCliSupervisor.activeSnapshots()
}

export function listExternalCliSessions() {
  return externalCliSupervisor.snapshots()
}

export function interruptExternalCliSessions(reason?: string) {
  return interruptSupervisedExternalCliSessions(reason)
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
    case 'gemini':
      return 'gemini'
    case 'cursor':
      // Never default to IDE `cursor` — opens GUI and hangs headless runs
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


function maxTurnsForDepth(depth?: string): number {
  switch (depth) {
    case 'fast':
      return 12
    case 'standard':
      return 24
    case 'deep':
      return 40
    case 'max':
      return 56
    case 'ultra':
      return 72
    default:
      return 32
  }
}

/**
 * Build argv for direct spawn (preferred). Avoids cmd.exe quoting breakage
 * on Chinese/multiline prompts which can leave CLI hung with no stdout.
 */
export function buildLocalCliArgv(input: LocalCliRunInput): {
  file: string
  args: string[]
  displayCommand: string
} {
  const file = resolveBinary(input.kind, input.binary)
  const maxPrompt = input.attachments?.length ? 24_000 : 12_000
  const prompt = input.prompt.slice(0, maxPrompt)
  const model = input.model?.trim()
  const effort = depthToCodexEffort(input.depth)
  const plan = input.agentMode === 'plan'
  const approval = resolveCliApproval(
    input.kind,
    input.approvalMode,
    input.unattended,
    input.agentMode,
  )
  const turns = String(maxTurnsForDepth(input.depth))
  // Headless Electron has no TTY — permission prompts hang forever with zero output.
  // Prefer non-blocking approval for all interactive CLI runs.
  const headlessApprove = !plan

  let args: string[] = []
  switch (input.kind) {
    case 'codex': {
      args = [
        'exec',
        '--json',
        '--color',
        'never',
        '--skip-git-repo-check',
      ]
      if (plan) args.push('-s', 'read-only')
      else if (approval.permissive || headlessApprove)
        args.push('--dangerously-bypass-approvals-and-sandbox')
      else args.push('-s', 'workspace-write')
      if (model) args.push('-m', model)
      args.push('-c', `model_reasoning_effort=${effort}`)
      args.push(prompt)
      break
    }
    case 'claude': {
      args = ['-p', '--output-format', 'stream-json', '--verbose']
      if (model) args.push('--model', model)
      if (plan) args.push('--permission-mode', 'plan')
      else if (approval.permissive || headlessApprove)
        args.push('--dangerously-skip-permissions')
      else args.push('--permission-mode', 'acceptEdits')
      args.push('--max-turns', turns)
      args.push(prompt)
      break
    }
    case 'grok': {
      // -p/--single headless; streaming-json for process feed
      args = [
        '-p',
        prompt,
        '--output-format',
        'streaming-json',
        '--max-turns',
        turns,
        '--reasoning-effort',
        effort,
      ]
      if (model) args.push('--model', model)
      if (plan) args.push('--permission-mode', 'plan')
      else if (approval.permissive || headlessApprove) args.push('--always-approve')
      else args.push('--permission-mode', 'auto', '--always-approve')
      break
    }
    case 'opencode': {
      args = ['run']
      if (model) args.push('--model', model)
      if (input.agentMode === 'build' || input.agentMode === 'plan') {
        args.push('--agent', input.agentMode)
      }
      if (input.thinkingVariant?.trim()) args.push('--variant', input.thinkingVariant.trim())
      if (input.showThinking) args.push('--thinking')
      args.push('--format', 'json')
      for (const file of input.attachmentPaths || []) args.push('--file', file)
      args.push(prompt)
      break
    }
    case 'gemini': {
      args = ['-p', prompt, '--output-format', 'json']
      if (model) args.push('--model', model)
      break
    }
    case 'cursor': {
      args = ['-p', '--output-format', 'stream-json']
      if (model) args.push('--model', model)
      if ((approval.permissive || headlessApprove) && !plan) args.push('--force')
      args.push(prompt)
      break
    }
    default:
      args = [prompt]
  }

  const displayCommand = [quoteShellArg(file), ...redactCliDisplayArgs(args, prompt).map((a) => quoteShellArg(a))].join(
    ' ',
  )
  return { file, args, displayCommand }
}

/**
 * Shell-string form (legacy / smoke / logging). Prefer buildLocalCliArgv for spawn.
 */
export function buildLocalCliCommand(input: LocalCliRunInput): string {
  const { displayCommand } = buildLocalCliArgv(input)
  return displayCommand
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

export async function runLocalCliAgent(
  input: LocalCliRunInput,
  dependencies: LocalCliRunDependencies = {},
): Promise<LocalCliRunResult> {
  const kind = input.kind
  const bin = resolveBinary(kind, input.binary)
  const runId = input.runId || randomUUID()
  const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : undefined
  const policy = normalizeExternalCliRunPolicy(input.externalCliPolicy)
  let activeSession: ExternalCliRunSession | undefined
  const emit = (ev: Omit<LocalCliStreamEvent, 'runId'>) => {
    try {
      const projection = activeSession?.snapshot()
      input.onStream?.({
        ...ev,
        runId,
        sequence: ev.sequence ?? projection?.eventCursor,
        sessionPhase: ev.sessionPhase ?? projection?.phase,
        providerSessionId: ev.providerSessionId ?? projection?.providerSessionId,
      })
    } catch {
      /* ignore */
    }
  }

  const pre = await preflightBinary(kind, bin)
  if (!pre.ok) {
    emit({ kind: 'error', title: 'CLI 找不到', detail: pre.error })
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

  const argv = buildLocalCliArgv({
    ...input,
    prompt,
    binary: pre.path || bin,
    attachmentPaths: materialized.paths,
  })
  let spawnFile = argv.file
  let spawnArgs = argv.args
  let command = argv.displayCommand
  let profilePath: string | undefined

  // Verified OS sandbox: wrap CLI under seatbelt (mac) / bwrap (linux).
  if (
    input.sandboxWrap &&
    (input.sandboxWrap.engine === 'seatbelt' || input.sandboxWrap.engine === 'bwrap') &&
    input.sandboxWrap.viewRoot
  ) {
    try {
      const wrapped = wrapCommandInSandbox({
        engine: input.sandboxWrap.engine,
        viewRoot: input.sandboxWrap.viewRoot,
        command: argv.file,
        args: argv.args,
      })
      spawnFile = wrapped.command
      spawnArgs = wrapped.args
      profilePath = wrapped.profilePath
      command = `${wrapped.command} ${wrapped.args.slice(0, 4).join(' ')} … (${argv.displayCommand})`
      emit({
        kind: 'status',
        title: 'Filesystem sandbox',
        detail: `engine=${input.sandboxWrap.engine} · view=${input.sandboxWrap.viewRoot}`,
      })
    } catch (e) {
      emit({
        kind: 'error',
        title: 'Sandbox wrap failed',
        detail: e instanceof Error ? e.message : String(e),
      })
      return {
        ok: false,
        output: '',
        command: argv.displayCommand,
        kind,
        code: 1,
        error: `無法在 filesystem sandbox 中啟動 CLI：${e instanceof Error ? e.message : e}`,
        runId,
      }
    }
  }

  emit({
    kind: 'status',
    title: `本機 ${kind} CLI`,
    detail: `model=${input.model || kind} · maxTurns=${maxTurnsForDepth(input.depth)}`,
  })
  emit({
    kind: 'status',
    title: '啟動 CLI',
    detail: `${spawnFile} (${spawnArgs.length} args${input.sandboxWrap ? ', sandboxed spawn' : ', direct spawn'})`,
  })

  // Parse NDJSON (Grok streaming-json) and plain lines into process events
  // while also feeding typed model/tool lifecycle activity into the durable
  // session. Raw process output remains a separate activity source.
  const operationTimeouts = new Map<string, Array<() => void>>()
  const emitParsedEvent = (event: Omit<LocalCliStreamEvent, 'runId'>) => {
    if (activeSession) {
      if (event.sessionPhase === 'waiting_for_user' || event.sessionPhase === 'waiting_for_approval') {
        activeSession.observe({ type: event.sessionPhase, detail: event.detail || event.title })
      } else if (event.kind === 'text' || event.kind === 'thought') {
        activeSession.observe({ type: 'model_activity', detail: event.detail, delta: event.delta })
      } else if (event.kind === 'tool') {
        const operation = `${event.tool || 'tool'}:${(event.detail || event.title || '').slice(0, 120)}`
        const starts = Boolean(event.title && (/開始|執行/.test(event.title) && !/已執行|完成/.test(event.title)))
        if (starts) {
          activeSession.observe({ type: 'tool_started', tool: event.tool, operation, detail: event.detail })
          const cancel = activeSession.armOperationTimeout(operation)
          operationTimeouts.set(operation, [...(operationTimeouts.get(operation) || []), cancel])
        } else {
          activeSession.observe({ type: 'tool_completed', tool: event.tool, operation, detail: event.detail, ok: event.ok })
          const pending = operationTimeouts.get(operation)
          pending?.shift()?.()
          if (pending?.length === 0) operationTimeouts.delete(operation)
        }
      } else if (event.kind === 'file') {
        activeSession.observe({ type: 'tool_completed', tool: event.tool || 'file', operation: event.path, detail: event.detail || event.title, ok: event.ok })
      } else if (event.kind === 'error') {
        activeSession.observe({ type: 'diagnostic', detail: event.detail || event.title || 'CLI error', severity: 'error' })
      } else if (event.kind === 'status' || event.kind === 'plan' || event.kind === 'done') {
        activeSession.observe({ type: 'provider_activity', detail: event.detail || event.title })
      }
    }
    emit(event)
  }
  const streamState = createCliStreamParser(kind, emitParsedEvent, (providerSessionId) => {
    activeSession?.observe({ type: 'provider_activity', providerSessionId, detail: 'provider session identity observed' })
  })
  let assembledText = ''

  const session = externalCliSessions.create({
    runId,
    conversationId: input.conversationId || runId,
    adapter: kind,
    clock: dependencies.clock,
    policy,
    unattended: input.unattended,
    processId: `cli:${runId}`,
    requiredConnectors: input.requiredConnectors,
    transport: {
      processId: `cli:${runId}`,
      terminateTree: async () => {
        const result = dependencies.cancelRun
          ? await dependencies.cancelRun(runId)
          : await cancelBashAndWait({ runId })
        return { confirmed: result.confirmed, detail: result.detail }
      },
      sendInput: (value) => dependencies.writeInput ? dependencies.writeInput(runId, value) : writeRunStdin(runId, value),
      sendApproval: (approved) => dependencies.writeInput
        ? dependencies.writeInput(runId, approved ? 'yes' : 'no')
        : writeRunStdin(runId, approved ? 'yes' : 'no'),
    },
    onEvent: (event) => {
      emit({
        ...externalLifecycleToStream(event),
        sequence: event.sequence,
      })
    },
  })
  activeSession = session
  session.start()

  // Direct argv spawn — do NOT wrap in cmd.exe (breaks CJK/multiline, can hang)
  let r
  try {
    r = await (dependencies.runArgv || runArgv)({
      file: spawnFile,
      args: spawnArgs,
      cwd,
      runId,
      onStarted: (processId) => session.observe({ type: 'process_started', processId: `cli:${processId}` }),
      tag: 'cli-agent',
      onStdout: (chunk) => {
        session.observe({ type: 'process_output', channel: 'stdout', detail: chunk })
        const stdoutDiagnostic = classifyExternalCliDiagnostic(chunk, { adapter: kind, headless: true })
        if (stdoutDiagnostic.kind === 'connector-authentication-required') {
          session.observe({
            type: 'connector_authentication_required',
            connector: stdoutDiagnostic.connector,
            server: stdoutDiagnostic.server,
            operation: stdoutDiagnostic.operation,
            required: stdoutDiagnostic.required === true || session.isRequiredConnector(stdoutDiagnostic),
            detail: stdoutDiagnostic.detail,
          })
        }
        const parsed = streamState.push(chunk, 'stdout')
        if (parsed.textDelta) assembledText += parsed.textDelta
      },
      onStderr: (chunk) => {
        session.observe({ type: 'process_output', channel: 'stderr', detail: chunk })
        const diagnostic = classifyExternalCliDiagnostic(chunk, { adapter: kind, headless: true })
        if (diagnostic.kind === 'connector-authentication-required') {
          session.observe({
            type: 'connector_authentication_required',
            connector: diagnostic.connector,
            server: diagnostic.server,
            operation: diagnostic.operation,
            required: diagnostic.required === true || session.isRequiredConnector(diagnostic),
            detail: diagnostic.detail,
          })
        } else {
          session.observe({ type: 'diagnostic', detail: diagnostic.detail, severity: diagnostic.severity })
        }
        streamState.push(chunk, 'stderr')
      },
      externalSession: true,
      timeoutMs: policy.absoluteMs,
    })
  } finally {
    if (profilePath) {
      try {
        fs.unlinkSync(profilePath)
      } catch {
        /* best-effort */
      }
    }
  }

  // Flush residual line buffer
  streamState.flush()
  for (const cancel of [...operationTimeouts.values()].flat()) cancel()

  if (r.timedOut && !session.snapshot().terminal) session.forceTimeout('absolute-timeout')
  else if (r.cancelled && !session.snapshot().terminal) session.cancelObserved('使用者取消')
  else if (!session.snapshot().terminal) session.observe({ type: 'process_exit', code: r.code, detail: r.stderr })

  // TUI CLIs may still leak CSI/OSC sequences into captured pipes
  const rawJoined = stripAnsi([r.stdout, r.stderr].filter(Boolean).join('\n\n')).trim()
  // Prefer assembled assistant text from streaming-json over raw NDJSON dump
  const fromStream = assembledText.trim() || streamState.getAssembledText().trim()
  const output = (fromStream || extractPlainFromNdjson(rawJoined) || rawJoined).trim()
  const cancelled = Boolean(r.cancelled)
  const attachNote =
    materialized.paths.length > 0
      ? `\n\n[attachments: ${materialized.paths.length} file(s) under ${materialized.dir}]`
      : ''
  const cleanErr = redactCliTelemetryText(stripAnsi(r.stderr || '').trim())
  const permissionError = streamState.getPermissionRequest()

  const terminal = session.snapshot().terminal
  const terminalClassification = terminal?.classification || (r.ok ? 'success' : cancelled ? 'user-cancelled' : 'process-exit-failure')
  // The supervised session is authoritative. A provider may exit zero after
  // the Host already classified a required connector, timeout, or cancellation
  // outcome; that must never be surfaced as a successful run.
  const resultOk = terminal ? terminal.classification === 'success' : r.ok
  emit({
    kind: resultOk ? 'done' : 'error',
    title: resultOk
      ? 'CLI 完成'
      : terminal
          ? formatExternalCliTerminal(terminal)
          : permissionError
            ? 'OpenCode 權限要求'
            : cancelled
              ? '已取消'
              : 'CLI 失敗',
    detail: resultOk ? undefined : terminal ? cleanErr || permissionError || undefined : permissionError || cleanErr || undefined,
    ok: resultOk,
    terminalClassification,
    sequence: session.snapshot().eventCursor,
    sessionPhase: session.snapshot().phase,
  })

  const sessionSnapshot = session.snapshot()
  const lastActivityAt = sessionSnapshot.lastMeaningfulActivityAt
  return {
    ok: resultOk,
    output:
      (output.slice(0, 100_000) ||
        (resultOk ? '(empty output)' : cancelled ? '已取消' : 'CLI 無輸出')) +
      (resultOk ? '' : attachNote),
    command,
    kind,
    code: r.code,
    timedOut: r.timedOut,
    cancelled,
    error: resultOk
      ? undefined
      : terminal
        ? formatExternalCliTerminal(terminal, { headless: true })
        : permissionError
          ? permissionError
          : cancelled
            ? '使用者取消'
            : cleanErr || `exit ${r.code}`,
    runId,
    configSnapshot: input.configSnapshot,
    terminalClassification,
    externalRun: {
      provider: kind,
      adapter: kind,
      runId,
      conversationId: input.conversationId || runId,
      processId: sessionSnapshot.processId,
      sessionId: sessionSnapshot.providerSessionId,
      status: terminal?.classification === 'success' ? 'success' : terminal?.classification === 'user-cancelled' ? 'aborted' : terminal?.classification === 'interrupted' ? 'interrupted' : 'failed',
      completionReason: terminal?.reason || terminalClassification,
      terminalClassification,
      eventCursor: sessionSnapshot.eventCursor,
      lastActivityAt: lastActivityAt !== undefined
        ? new Date(lastActivityAt).toISOString()
        : undefined,
      outputOmittedBytes: sessionSnapshot.output.omittedBytes,
      startedAt: new Date(sessionSnapshot.startedAt).toISOString(),
      finishedAt: terminal ? new Date(terminal.at).toISOString() : undefined,
    },
  }
}

/** Strip CSI/OSC/ANSI sequences so TUI CLIs don't dump color garbage into chat. */
export function stripAnsi(text: string): string {
  if (!text) return ''
  return text
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g, '')
    .replace(/\r/g, '')
}

/** Normalize vendor todo/plan payload entries → LocalCliPlanItem[] */
export function normalizePlanItems(raw: unknown): LocalCliPlanItem[] {
  if (!Array.isArray(raw)) return []
  const out: LocalCliPlanItem[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ text: entry.trim().slice(0, 200), status: 'pending' })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const text = String(e.content ?? e.text ?? e.step ?? e.title ?? e.task ?? '').trim()
    if (!text) continue
    const s = String(e.status ?? '').toLowerCase()
    const status: LocalCliPlanItem['status'] =
      e.completed === true || s.includes('complete') || s.includes('done')
        ? 'done'
        : s.includes('progress') || s.includes('active')
          ? 'active'
          : 'pending'
    out.push({ text: text.slice(0, 200), status })
  }
  return out.slice(0, 40)
}

export type OpenCodeNormalizedEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'thought'; delta: string }
  | { kind: 'status'; title: string; detail?: string; ok?: boolean; sessionPhase?: 'waiting_for_user' | 'waiting_for_approval' }
  | { kind: 'tool'; title: string; tool: string; detail?: string; ok?: boolean; sessionPhase?: 'waiting_for_approval' }
  | { kind: 'file'; title: string; path: string; paths: string[]; action: 'edit' | 'create' | 'delete' }
  | { kind: 'plan'; title: string; todos: LocalCliPlanItem[] }
  | { kind: 'error'; title: string; detail: string; ok: false; permission?: string; sessionPhase?: 'waiting_for_approval' }

/** Normalize OpenCode `run --format json` events without coupling the runner to one version. */
export function normalizeOpenCodeEvent(raw: Record<string, unknown>): OpenCodeNormalizedEvent | null {
  const type = String(raw.type || raw.event || raw.name || '').toLowerCase()
  const subtype = String(raw.subtype || raw.status || '').toLowerCase()
  const part = raw.part && typeof raw.part === 'object' ? (raw.part as Record<string, unknown>) : raw
  const text = String(part.text ?? part.delta ?? part.content ?? raw.data ?? '').trim()

  if (type.includes('question') || type.includes('input') || type.includes('ask_user') || type.includes('user.wait')) {
    return { kind: 'status', title: 'OpenCode 等待你的回覆', detail: text || String(raw.message ?? raw.reason ?? '').slice(0, 400), sessionPhase: 'waiting_for_user' }
  }

  if (type === 'text' || type === 'message' || type === 'assistant' || type === 'content' || part.type === 'text') {
    return text ? { kind: 'text', delta: text } : null
  }
  if (type === 'reasoning' || type === 'thinking' || type === 'thought' || part.type === 'reasoning') {
    return text ? { kind: 'thought', delta: text } : null
  }
  if (type.includes('permission') || type === 'permission.asked' || type === 'permission_request') {
    const detail = String(raw.message ?? raw.reason ?? raw.permission ?? raw.title ?? text ?? 'OpenCode permission request')
    return {
      kind: 'error',
      title: 'OpenCode 權限要求',
      detail: `${detail.slice(0, 380)}（一次性 CLI 無法回覆 permission request，已停止並請改用 server adapter）`,
      ok: false,
      permission: detail.slice(0, 380),
      sessionPhase: 'waiting_for_approval',
    }
  }
  if (type === 'tool_use' || type === 'tool_call' || type === 'tool' || type === 'tool_result' || type === 'function_call') {
    const name = String(raw.name ?? raw.tool ?? raw.tool_name ?? part.name ?? 'tool')
    const input = raw.input ?? raw.arguments ?? part.input ?? part.arguments
    return {
      kind: 'tool',
      title: type === 'tool_result' || subtype === 'completed' ? `已執行 ${name}` : `執行 ${name}…`,
      tool: name,
      detail: input && typeof input === 'object' ? JSON.stringify(input).slice(0, 400) : String(input ?? raw.result ?? '').slice(0, 400),
      ok: raw.error == null && raw.ok !== false,
    }
  }
  if (type === 'file' || type === 'edit' || type === 'write' || type === 'delete' || type === 'file_change' || type === 'file_edit') {
    const file = String(raw.path ?? raw.file ?? raw.filename ?? part.path ?? '').trim()
    if (!file) return null
    const action = type === 'write' || type === 'file_change' ? 'create' : type === 'delete' ? 'delete' : 'edit'
    return { kind: 'file', title: `已編輯 ${file.split(/[\\/]/).pop()}`, path: file, paths: [file], action }
  }
  if (type === 'todo' || type === 'todos' || type === 'plan' || type === 'todowrite' || type === 'update_plan') {
    const todos = normalizePlanItems(raw.todos ?? raw.plan ?? raw.items ?? part.todos ?? part.items)
    return todos.length ? { kind: 'plan', title: '任務清單更新', todos } : null
  }
  if (type === 'error' || type === 'failed' || subtype === 'error') {
    return { kind: 'error', title: 'OpenCode 錯誤', detail: String(raw.message ?? raw.error ?? text ?? 'unknown error').slice(0, 400), ok: false }
  }
  if (type === 'step_start' || type === 'step_finish' || type === 'status' || type === 'server.connected' || type === 'session.status') {
    return { kind: 'status', title: type, detail: String(raw.message ?? raw.status ?? raw.reason ?? '').slice(0, 220), ok: subtype !== 'error' }
  }
  if (type === 'finish' || type === 'done' || type === 'complete' || type === 'session.completed') {
    return { kind: 'status', title: '回合完成', detail: String(raw.reason ?? raw.status ?? '').slice(0, 220), ok: true }
  }
  return null
}

/**
 * Line-buffer stdout and emit structured events for all vendor JSONL dialects:
 * - Grok: {type:thought|text|end, data}
 * - Claude: {type:assistant|result|tool_*, message:{content:[{text}]}}
 * - Codex: {type:item.completed|error|turn.*, item:{type,text|message|…}}
 * - Cursor agent: similar to Claude stream-json (assistant/tool_call/result)
 */
function createCliStreamParser(
  kind: LocalCliKind,
  emit: (ev: Omit<LocalCliStreamEvent, 'runId'>) => void,
  onProviderSession?: (providerSessionId: string) => void,
) {
  let buf = ''
  let assembledText = ''
  let lastPlainEmit = 0
  let plainLineCount = 0
  const jsonStreaming =
    kind === 'grok' ||
    kind === 'claude' ||
    kind === 'codex' ||
    kind === 'gemini' ||
    kind === 'cursor' ||
    kind === 'opencode'
  let permissionRequest = ''

  const appendText = (data: string) => {
    if (!data) return ''
    assembledText += data
    emit({ kind: 'text', channel: 'text', delta: data })
    return data
  }

  const extractTextFromContent = (content: unknown): string => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    const parts: string[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && b.text != null) parts.push(String(b.text))
      else if (typeof b.text === 'string') parts.push(b.text)
    }
    return parts.join('')
  }

  const handleLine = (line: string, channel: 'stdout' | 'stderr') => {
    const clean = stripAnsi(line).trim()
    if (!clean) return { textDelta: '' }

    // NDJSON object line
    if (clean.startsWith('{') && clean.endsWith('}')) {
      try {
        const j = JSON.parse(clean) as Record<string, unknown>
        const type = String(j.type || j.event || '')
        const subtype = String(j.subtype || '')
        const providerSessionId = String(
          j.session_id ?? j.sessionId ?? j.thread_id ?? j.threadId ?? j.conversation_id ?? '',
        ).trim()
        if (providerSessionId) onProviderSession?.(providerSessionId.slice(0, 200))

        // Provider lifecycle evidence is the only source allowed to enter a
        // waiting phase.  A wrapper's generic stderr line never fabricates
        // this state; typed NDJSON input/approval events do.
        const lowerType = type.toLowerCase()
        if (lowerType.includes('question') || lowerType.includes('input_required') || lowerType.includes('ask_user') || lowerType.includes('user.wait')) {
          emit({ kind: 'status', title: '等待你的回覆', detail: String(j.message ?? j.reason ?? j.prompt ?? '').slice(0, 400), sessionPhase: 'waiting_for_user' })
          return { textDelta: '' }
        }
        if (lowerType.includes('permission') || lowerType.includes('approval_required') || lowerType.includes('approval.request')) {
          emit({ kind: 'error', title: '等待核准', detail: String(j.message ?? j.reason ?? j.permission ?? '').slice(0, 400), ok: false, sessionPhase: 'waiting_for_approval' })
          return { textDelta: '' }
        }

        if (kind === 'opencode') {
          const normalized = normalizeOpenCodeEvent(j)
          if (normalized) {
            if (normalized.kind === 'text' || normalized.kind === 'thought') {
              if (normalized.kind === 'text') return { textDelta: appendText(normalized.delta) }
              emit(normalized)
              return { textDelta: '' }
            }
            if (normalized.kind === 'error' && normalized.permission) permissionRequest = normalized.detail
            emit(normalized)
            return { textDelta: '' }
          }
        }

        // ── Grok ──
        if (type === 'thought' || type === 'reasoning' || type === 'thinking') {
          const data = String(j.data ?? j.content ?? j.delta ?? '')
          if (data) emit({ kind: 'thought', channel: 'thought', delta: data })
          return { textDelta: '' }
        }
        if (type === 'text' || type === 'content') {
          return { textDelta: appendText(String(j.data ?? j.content ?? j.delta ?? j.text ?? '')) }
        }

        // Gemini CLI provider-json: the one-shot response is commonly exposed
        // as `response` or `text` without a Claude-style message envelope.
        if (kind === 'gemini' && (j.response || j.text || j.output)) {
          return { textDelta: appendText(String(j.response ?? j.text ?? j.output ?? '')) }
        }

        // ── Claude / Cursor: assistant message ──
        if (type === 'assistant' || type === 'message') {
          const msg = (j.message && typeof j.message === 'object'
            ? (j.message as Record<string, unknown>)
            : j) as Record<string, unknown>
          const text =
            extractTextFromContent(msg.content) ||
            String(j.data ?? j.delta ?? j.text ?? msg.text ?? '')
          // Skip huge synthetic hook dumps with empty useful text
          if (text) return { textDelta: appendText(text) }
          return { textDelta: '' }
        }

        // ── Claude/Cursor result (final answer) ──
        if (type === 'result') {
          const resultText = String(j.result ?? j.data ?? '')
          // Prefer streamed assistant text; if empty, use result field
          if (resultText && !assembledText.trim()) {
            appendText(resultText)
          }
          const err = j.is_error === true || Boolean(j.error)
          emit({
            kind: err ? 'error' : 'status',
            title: err ? 'CLI 錯誤' : '回合結束',
            detail: err
              ? String(j.error || j.result || subtype || '').slice(0, 400)
              : String(j.stop_reason ?? j.duration_ms ?? subtype ?? '').slice(0, 200),
            ok: !err,
          })
          return { textDelta: '' }
        }

        // ── Codex JSONL ──
        if (type === 'item.completed' || type === 'item.started' || type === 'item.updated') {
          const item =
            j.item && typeof j.item === 'object'
              ? (j.item as Record<string, unknown>)
              : ({} as Record<string, unknown>)
          const itemType = String(item.type || '')
          if (
            itemType === 'agent_message' ||
            itemType === 'message' ||
            itemType === 'assistant_message'
          ) {
            const text = String(item.text ?? item.message ?? item.content ?? '')
            return { textDelta: appendText(text) }
          }
          if (itemType === 'reasoning' || itemType === 'thought') {
            const t = String(item.text ?? item.content ?? '')
            if (t) emit({ kind: 'thought', channel: 'thought', delta: t })
            return { textDelta: '' }
          }
          if (
            itemType === 'command_execution' ||
            itemType === 'command' ||
            itemType === 'shell'
          ) {
            const cmd = String(item.command ?? item.cmd ?? item.text ?? 'command')
            emit({
              kind: 'tool',
              title: type === 'item.started' ? `執行指令…` : `已執行指令`,
              tool: 'bash',
              detail: cmd.slice(0, 400),
              ok: item.exit_code === undefined || item.exit_code === 0,
            })
            return { textDelta: '' }
          }
          if (
            itemType === 'file_change' ||
            itemType === 'file_edit' ||
            itemType === 'patch' ||
            itemType === 'file_change_set'
          ) {
            // Codex may send changes[] or single path
            const changes = Array.isArray(item.changes)
              ? (item.changes as Array<Record<string, unknown>>)
              : Array.isArray(item.files)
                ? (item.files as Array<Record<string, unknown>>)
                : null
            if (changes?.length) {
              const paths: string[] = []
              for (const c of changes) {
                const p = String(c.path ?? c.file ?? c.filename ?? '')
                if (!p) continue
                paths.push(p)
                emit({
                  kind: 'file',
                  title: `已編輯 ${p.split(/[\\/]/).pop()}`,
                  detail: p,
                  path: p,
                  paths: [p],
                  added: typeof c.additions === 'number' ? c.additions : typeof c.added === 'number' ? c.added : undefined,
                  removed: typeof c.deletions === 'number' ? c.deletions : typeof c.removed === 'number' ? c.removed : undefined,
                  action: String(c.kind || c.action || '').includes('create')
                    ? 'create'
                    : String(c.kind || c.action || '').includes('delete')
                      ? 'delete'
                      : 'edit',
                })
              }
              return { textDelta: '' }
            }
            const p = String(item.path ?? item.file ?? item.filename ?? '')
            if (p) {
              emit({
                kind: 'file',
                title: `已編輯 ${p.split(/[\\/]/).pop()}`,
                detail: p,
                path: p,
                paths: [p],
                added: typeof item.additions === 'number' ? item.additions : undefined,
                removed: typeof item.deletions === 'number' ? item.deletions : undefined,
                action: 'edit',
              })
            }
            return { textDelta: '' }
          }
          if (itemType === 'error') {
            emit({
              kind: 'error',
              title: 'Codex 錯誤',
              detail: String(item.message ?? item.text ?? '').slice(0, 400),
              ok: false,
            })
            return { textDelta: '' }
          }
          // Codex 任務清單（plan tool）→ 右側面板同步
          if (itemType === 'todo_list' || itemType === 'plan' || itemType === 'update_plan') {
            const todos = normalizePlanItems(item.items ?? item.plan ?? item.todos)
            if (todos.length) {
              emit({ kind: 'plan', title: '任務清單更新', todos })
            }
            return { textDelta: '' }
          }
          // other item types — light status
          if (itemType) {
            emit({
              kind: 'status',
              title: itemType,
              detail: String(item.message ?? item.text ?? '').slice(0, 200),
            })
          }
          return { textDelta: '' }
        }
        if (type === 'turn.started') {
          emit({ kind: 'status', title: '回合開始' })
          return { textDelta: '' }
        }
        if (type === 'turn.completed' || type === 'turn.failed') {
          emit({
            kind: type === 'turn.failed' ? 'error' : 'status',
            title: type === 'turn.failed' ? '回合失敗' : '回合完成',
            detail: String(
              (j.error as { message?: string } | undefined)?.message ?? j.message ?? '',
            ).slice(0, 300),
            ok: type !== 'turn.failed',
          })
          return { textDelta: '' }
        }
        if (type === 'error' || type === 'rate_limit_event') {
          const msg =
            typeof j.message === 'string'
              ? j.message
              : String(
                  (j.rate_limit_info as { status?: string } | undefined)?.status ||
                    j.error ||
                    'error',
                )
          emit({ kind: 'error', title: type === 'rate_limit_event' ? '用量限制' : '錯誤', detail: msg.slice(0, 400), ok: false })
          return { textDelta: '' }
        }
        if (type === 'thread.started' || type === 'system') {
          // init noise — keep feed clean unless useful subtype
          if (subtype === 'init') {
            emit({
              kind: 'status',
              title: 'CLI 就緒',
              detail: String(j.model || j.cwd || '').slice(0, 120),
            })
          }
          return { textDelta: '' }
        }

        // ── Generic tool events (Claude/Cursor/Grok) ──
        if (
          type === 'tool' ||
          type === 'tool_use' ||
          type === 'tool_call' ||
          type === 'tool_result' ||
          type === 'function_call' ||
          type === 'content_block_start' ||
          type === 'content_block_stop'
        ) {
          let name = String(j.name ?? j.tool ?? j.tool_name ?? 'tool')
          const inputObj =
            j.input && typeof j.input === 'object'
              ? (j.input as Record<string, unknown>)
              : j.arguments && typeof j.arguments === 'object'
                ? (j.arguments as Record<string, unknown>)
                : null
          let detail = inputObj
            ? JSON.stringify(inputObj).slice(0, 400)
            : String(j.input ?? j.arguments ?? j.result ?? j.data ?? j.content ?? '').slice(0, 400)

          // Claude TodoWrite / update_plan 類工具 → 任務清單快照
          if (inputObj && /todo|plan|task/i.test(name)) {
            const todos = normalizePlanItems(
              inputObj.todos ?? inputObj.plan ?? inputObj.items ?? inputObj.tasks,
            )
            if (todos.length) {
              emit({ kind: 'plan', tool: name, title: '任務清單更新', todos })
              return { textDelta: '' }
            }
          }

          // Claude Write/Edit/Read tools
          const claudePath = inputObj
            ? String(inputObj.path ?? inputObj.file_path ?? inputObj.filePath ?? '')
            : ''
          if (
            claudePath &&
            /write|edit|create|multi_edit|notebook|update/i.test(name)
          ) {
            emit({
              kind: 'file',
              title: `已編輯 ${claudePath.split(/[\\/]/).pop()}`,
              tool: name,
              detail: claudePath,
              path: claudePath,
              paths: [claudePath],
              action: /create|write/i.test(name) ? 'create' : 'edit',
              ok: true,
            })
            return { textDelta: '' }
          }
          if (claudePath && /bash|shell|terminal/i.test(name)) {
            emit({
              kind: 'tool',
              title: subtype === 'started' ? '執行指令…' : '已執行指令',
              tool: name,
              detail: String(inputObj?.command ?? detail).slice(0, 400),
              ok: true,
            })
            return { textDelta: '' }
          }
          if (claudePath && /read|grep|glob|list/i.test(name)) {
            emit({
              kind: 'tool',
              title: `已讀取 ${claudePath.split(/[\\/]/).pop()}`,
              tool: name,
              detail: claudePath,
              ok: true,
            })
            return { textDelta: '' }
          }

          // Cursor: tool_call nested object
          const tc = j.tool_call
          if (tc && typeof tc === 'object') {
            const keys = Object.keys(tc as object)
            if (keys[0]) name = keys[0]
            detail = JSON.stringify(tc).slice(0, 400)
            const write = (tc as Record<string, { args?: { path?: string }; result?: { success?: { linesCreated?: number; fileSize?: number } } }>).writeToolCall
            const read = (tc as Record<string, { args?: { path?: string } }>).readToolCall
            const edit = (tc as Record<string, { args?: { path?: string } }>).editToolCall
            const pathStr = write?.args?.path || edit?.args?.path || read?.args?.path
            if (pathStr && (write || edit)) {
              emit({
                kind: 'file',
                title: `已編輯 ${pathStr.split(/[\\/]/).pop()}`,
                tool: name,
                detail: pathStr,
                path: pathStr,
                paths: [pathStr],
                action: write ? 'create' : 'edit',
                added: write?.result?.success?.linesCreated,
                ok: true,
              })
              return { textDelta: '' }
            }
            if (pathStr && read) {
              emit({
                kind: 'tool',
                title: `已讀取 ${pathStr.split(/[\\/]/).pop()}`,
                tool: name,
                detail: pathStr,
                ok: true,
              })
              return { textDelta: '' }
            }
          }

          // Bash-like tools → 「已執行指令」
          if (/bash|shell|terminal|powershell|command|run_terminal/i.test(name)) {
            emit({
              kind: 'tool',
              title: subtype === 'started' ? '執行指令…' : '已執行指令',
              tool: name,
              detail,
              ok: j.ok !== false && subtype !== 'error',
            })
            return { textDelta: '' }
          }

          emit({
            kind: 'tool',
            title:
              subtype === 'started'
                ? `執行 ${name}…`
                : subtype === 'completed'
                  ? `已執行 ${name}`
                  : `工具 ${name}`,
            tool: name,
            detail,
            ok: j.ok !== false && subtype !== 'error',
          })
          return { textDelta: '' }
        }
        if (type === 'file' || type === 'edit' || type === 'write') {
          const pathStr = String(j.path ?? j.file ?? j.filename ?? '')
          emit({
            kind: 'file',
            title: pathStr ? `已編輯 ${pathStr.split(/[\\/]/).pop()}` : '已編輯檔案',
            detail: pathStr,
            path: pathStr || undefined,
            paths: pathStr ? [pathStr] : undefined,
            action: 'edit',
          })
          return { textDelta: '' }
        }
        if (type === 'end' || type === 'done') {
          emit({
            kind: 'status',
            title: '回合結束',
            detail: String(j.stopReason ?? j.reason ?? '').slice(0, 200),
          })
          return { textDelta: '' }
        }
        // Unknown JSON — skip noisy system hooks; light log otherwise
        if (type && type !== 'user') {
          emit({
            kind: 'log',
            title: type + (subtype ? `/${subtype}` : ''),
            detail: clean.slice(0, 160),
          })
        }
        return { textDelta: '' }
      } catch {
        /* fall through to plain */
      }
    }

    // JSON-streaming vendors: ignore non-JSON lines (progress chrome)
    if (jsonStreaming) {
      return { textDelta: '' }
    }
    // Plain text CLIs (e.g. opencode): throttle log noise into feed
    plainLineCount += 1
    const now = Date.now()
    if (plainLineCount <= 40 || now - lastPlainEmit > 400) {
      lastPlainEmit = now
      emit({
        kind: 'chunk',
        channel,
        detail: clean.slice(0, 400),
        title: channel === 'stderr' ? 'stderr' : '輸出',
      })
      // Also treat plain stdout lines as draft text for opencode
      if (channel === 'stdout' && kind === 'opencode') {
        return { textDelta: appendText(clean + '\n') }
      }
    }
    return { textDelta: '' }
  }

  return {
    push(chunk: string, channel: 'stdout' | 'stderr') {
      let textDelta = ''
      buf += chunk
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const r = handleLine(line, channel)
        if (r.textDelta) textDelta += r.textDelta
      }
      return { textDelta }
    },
    flush() {
      if (buf.trim()) {
        handleLine(buf, 'stdout')
        buf = ''
      }
    },
    getAssembledText() {
      return assembledText
    },
    getPermissionRequest() {
      return permissionRequest
    },
  }
}

/** If final stdout is NDJSON, extract assistant/text/result fields only */
export function extractPlainFromNdjson(raw: string): string {
  if (!raw.includes('"type"')) return ''
  const parts: string[] = []
  let lastResult = ''
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const j = JSON.parse(t) as Record<string, unknown>
      const type = String(j.type || '')
      if (type === 'text' || type === 'message') {
        const d = j.data ?? j.content ?? j.text
        if (d && typeof d === 'string') parts.push(d)
      } else if (type === 'assistant') {
        const msg = j.message as { content?: unknown } | undefined
        if (msg?.content && Array.isArray(msg.content)) {
          for (const b of msg.content as Array<{ type?: string; text?: string }>) {
            if (b?.type === 'text' && b.text) parts.push(b.text)
          }
        }
      } else if (type === 'result' && typeof j.result === 'string') {
        lastResult = j.result
      } else if (type === 'item.completed') {
        const item = j.item as { type?: string; text?: string; message?: string } | undefined
        if (
          item &&
          (item.type === 'agent_message' || item.type === 'message') &&
          (item.text || item.message)
        ) {
          parts.push(String(item.text || item.message))
        }
      }
    } catch {
      /* skip */
    }
  }
  const joined = parts.join('')
  return joined || lastResult
}
