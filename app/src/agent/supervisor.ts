/**
 * Runtime supervisor — enforces context window / memory constraints
 * inspired by MemoryConstraintViolation in design mock (loop_7).
 */

export interface SupervisorLimits {
  /** Max bytes for a single tool output */
  maxToolPayloadBytes: number
  /** Max cumulative tool output bytes in one step */
  maxStepContextBytes: number
  /** Max function-calling rounds per step */
  maxToolRounds: number
}

export const DEFAULT_SUPERVISOR_LIMITS: SupervisorLimits = {
  maxToolPayloadBytes: 50 * 1024, // 50 KB (display uses MB in UI for drama; real limit is practical)
  maxStepContextBytes: 200 * 1024,
  maxToolRounds: 4,
}

export class SupervisorViolation extends Error {
  readonly code: string
  readonly detail: string
  readonly exitCode: number

  constructor(code: string, detail: string, exitCode = 137) {
    super(`${code}: ${detail}`)
    this.name = 'SupervisorViolation'
    this.code = code
    this.detail = detail
    this.exitCode = exitCode
  }
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Truncate tool output or throw if hard-fail mode and over limit. */
export function enforceToolPayload(
  tool: string,
  output: string,
  limits: SupervisorLimits,
  mode: 'truncate' | 'halt' = 'truncate',
): { output: string; truncated: boolean; bytes: number } {
  const bytes = byteLength(output)
  if (bytes <= limits.maxToolPayloadBytes) {
    return { output, truncated: false, bytes }
  }

  if (mode === 'halt') {
    throw new SupervisorViolation(
      'MemoryConstraintViolation',
      `Tool output payload from '${tool}' reached ${(bytes / (1024 * 1024)).toFixed(1)} MB, exceeding the configured context window limit of ${(limits.maxToolPayloadBytes / (1024 * 1024)).toFixed(1)} MB.`,
    )
  }

  // Binary-search-ish slice by characters (approx)
  let cut = Math.floor(output.length * (limits.maxToolPayloadBytes / bytes))
  let sliced = output.slice(0, cut)
  while (byteLength(sliced) > limits.maxToolPayloadBytes && cut > 0) {
    cut = Math.floor(cut * 0.9)
    sliced = output.slice(0, cut)
  }
  return {
    output: `${sliced}\n\n…[truncated by supervisor: ${bytes} bytes → ${byteLength(sliced)} bytes]`,
    truncated: true,
    bytes,
  }
}

export type ToolPayloadSpillAdapter = {
  write: (input: {
    tool: string
    output: string
    runId?: string
    threadId?: string
    projectRoot?: string
  }) => Promise<{ locator: string; bytes: number }>
}

export type EnforcedToolPayload = {
  output: string
  truncated: boolean
  spilled?: boolean
  locator?: string
  bytes: number
}

/** Async enforcement seam: persist oversized output and expose only a locator. */
export async function enforceToolPayloadWithSpill(
  tool: string,
  output: string,
  limits: SupervisorLimits,
  mode: 'truncate' | 'halt' = 'truncate',
  spill?: ToolPayloadSpillAdapter,
  context?: { runId?: string; threadId?: string; projectRoot?: string },
): Promise<EnforcedToolPayload> {
  const bytes = byteLength(output)
  if (bytes <= limits.maxToolPayloadBytes) return { output, truncated: false, bytes }
  if (mode === 'halt') return enforceToolPayload(tool, output, limits, mode)
  if (!spill || !context?.runId) return enforceToolPayload(tool, output, limits, mode)
  const record = await spill.write({ tool, output, ...context })
  return {
    output: [
      `Tool output from '${tool}' was stored outside the model context (${bytes} bytes).`,
      `Locator: ${record.locator}`,
      'Use tool_output_read with this locator and a bounded offset/maxBytes to inspect more.',
    ].join('\n'),
    truncated: false,
    spilled: true,
    locator: record.locator,
    bytes,
  }
}

export function enforceStepContextBudget(
  chunks: string[],
  limits: SupervisorLimits,
): { text: string; truncated: boolean } {
  let total = 0
  const kept: string[] = []
  let truncated = false
  for (const c of chunks) {
    const b = byteLength(c)
    if (total + b > limits.maxStepContextBytes) {
      truncated = true
      break
    }
    kept.push(c)
    total += b
  }
  return { text: kept.join('\n\n'), truncated }
}
