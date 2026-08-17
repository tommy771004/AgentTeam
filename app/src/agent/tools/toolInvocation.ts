/**
 * Tool Invocation — gated tools (builtin + custom + MCP).
 *
 * Single seam: authorize → execute → supervisor → record → afterTool.
 * Agent-level tools (plan / load_capability / tool_search / run_code / delegate)
 * stay outside — see agentLevelTools.ts.
 *
 * Supervisor: default **truncate only**; optional haltOnPayloadOverflow rethrows SupervisorViolation.
 * Heuristic callers leave halt off (truncate only).
 *
 * Adapters are required (authorize / execute).
 */
import type { ToolCallRecord } from '../types.ts'
import type { AuthorizeResult } from './toolGuard.ts'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  enforceToolPayloadWithSpill,
  type ToolPayloadSpillAdapter,
  type SupervisorLimits,
  SupervisorViolation,
} from '../supervisor.ts'

/** Same allow/deny discriminant as toolGuard.AuthorizeResult — call sites pass through. */
export type GatedAuthorizeResult = AuthorizeResult

export type GatedExecuteResult = { ok: boolean; output: string }

export type InvokeGatedToolInput = {
  tool: string
  input: Record<string, unknown>
  /** Injected Approval Decision / HITL adapter (guard-shaped result). */
  authorize: () => Promise<GatedAuthorizeResult>
  /** Injected execute (builtin / custom / MCP / fake). */
  execute: () => Promise<GatedExecuteResult>
  supervisorLimits?: SupervisorLimits
  /** When true, payload overflow rethrows SupervisorViolation (FC settings). */
  haltOnPayloadOverflow?: boolean
  step?: number
  sourceKind?: string
  objective?: string
  startedAt?: number
  nowTime?: () => string
  newId?: () => string
  onLog?: (level: string, message: string) => void
  onRecord?: (record: ToolCallRecord) => void
  evaluateAfterTool?: (ctx: {
    tool: string
    toolOk: boolean
    sourceKind?: string
    objective?: string
  }) =>
    | { audits: string[]; notifications: string[] }
    | Promise<{ audits: string[]; notifications: string[] }>
  notify?: (title: string, body: string) => void
  spill?: ToolPayloadSpillAdapter
  runId?: string
  threadId?: string
  projectRoot?: string
}

export type InvokeGatedToolResult = {
  ok: boolean
  output: string
  record: ToolCallRecord
  chunk: string
  /** True only for authorize / HITL refuse (tool never executed). Always set. */
  denied: boolean
}

function makeRecord(opts: {
  id: string
  tool: string
  input: Record<string, unknown>
  output: string
  ok: boolean
  durationMs: number
  timestamp: string
  step?: number
}): ToolCallRecord {
  return {
    id: opts.id,
    tool: opts.tool,
    input: opts.input,
    output: opts.output.slice(0, 4000),
    ok: opts.ok,
    durationMs: opts.durationMs,
    timestamp: opts.timestamp,
    step: opts.step,
  }
}

function chunkFor(tool: string, output: string): string {
  return `### tool:${tool}\n${output.slice(0, 2000)}`
}

async function runAfterTool(
  opts: InvokeGatedToolInput,
  toolOk: boolean,
): Promise<void> {
  if (!opts.evaluateAfterTool) return
  try {
    const ev = await opts.evaluateAfterTool({
      tool: opts.tool,
      toolOk,
      sourceKind: opts.sourceKind,
      objective: opts.objective,
    })
    for (const line of ev.audits) opts.onLog?.('INFO', line)
    for (const n of ev.notifications) {
      opts.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Invoke one gated tool end-to-end.
 * Auth deny and execute throws become structured results (no throw to caller),
 * except supervisor halt which rethrows SupervisorViolation.
 */
export async function invokeGatedTool(
  opts: InvokeGatedToolInput,
): Promise<InvokeGatedToolResult> {
  const started = opts.startedAt ?? Date.now()
  const nowTime =
    opts.nowTime ||
    (() => new Date().toLocaleTimeString('en-GB', { hour12: false }))
  const newId = opts.newId || (() => `tool_${Date.now().toString(36)}`)

  const auth = await opts.authorize()
  if (!auth.allowed) {
    const durationMs = Date.now() - started
    const record = makeRecord({
      id: newId(),
      tool: opts.tool,
      input: opts.input,
      output: auth.output,
      ok: false,
      durationMs,
      timestamp: nowTime(),
      step: opts.step,
    })
    opts.onRecord?.(record)
    opts.onLog?.('WARN', auth.output)
    return {
      ok: false,
      denied: true,
      output: auth.output,
      record,
      chunk: chunkFor(opts.tool, auth.output),
    }
  }

  let execOk = false
  let out = ''
  try {
    const result = await opts.execute()
    execOk = result.ok
    out = result.output
  } catch (e) {
    execOk = false
    out = e instanceof Error ? e.message : String(e)
    opts.onLog?.('WARN', `tool:${opts.tool} throw: ${out}`)
  }

  const mode = opts.haltOnPayloadOverflow ? 'halt' : 'truncate'
  try {
    const enforced = await enforceToolPayloadWithSpill(
      opts.tool,
      out,
      opts.supervisorLimits || DEFAULT_SUPERVISOR_LIMITS,
      mode,
      opts.spill,
      { runId: opts.runId, threadId: opts.threadId, projectRoot: opts.projectRoot },
    )
    out = enforced.output
    if (enforced.spilled) {
      opts.onLog?.(
        'WARN',
        `Supervisor spilled '${opts.tool}' (${enforced.bytes} bytes) → ${enforced.locator}`,
      )
    } else if (enforced.truncated) {
      opts.onLog?.(
        'WARN',
        `Supervisor truncated '${opts.tool}' (${enforced.bytes} bytes)`,
      )
    }
  } catch (e) {
    if (e instanceof SupervisorViolation) {
      opts.onLog?.('ERROR', e.message)
      throw e
    }
    throw e
  }

  const durationMs = Date.now() - started
  const record = makeRecord({
    id: newId(),
    tool: opts.tool,
    input: opts.input,
    output: out,
    ok: execOk,
    durationMs,
    timestamp: nowTime(),
    step: opts.step,
  })
  opts.onRecord?.(record)
  opts.onLog?.(
    execOk ? 'SUCCESS' : 'WARN',
    `tool:${opts.tool} ${execOk ? 'ok' : 'fail'} (${durationMs}ms)`,
  )

  await runAfterTool(opts, execOk)

  return {
    ok: execOk,
    denied: false,
    output: out,
    record,
    chunk: chunkFor(opts.tool, out),
  }
}
