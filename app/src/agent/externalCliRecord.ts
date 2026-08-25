/**
 * A Turn Record for an external CLI run.
 *
 * A user who switches provider should not drop into a worse, older view: the
 * conversation rows, the execution rows and the produced-files list all come
 * from one projection, so the external path has to feed it the same entries
 * the builtin loop does.
 *
 * What must NOT be the same is the claim. The record carries the runner's own
 * capability declaration, so identical presentation can never be mistaken for
 * identical guarantees — this path runs no builtin Parse, evaluates no
 * Definition of Done, and never iterates.
 */
import { EXTERNAL_CLI_RUNNER_CAPABILITIES } from './runners/types.ts'
import type { PiTurnSettlement } from './piHostRun.ts'
import { appendTurnRecord, type TurnRecord, type TurnRecordAppend } from './turnRecord.ts'

/** The subset of a CLI stream event this builder reads. */
export type ExternalCliRecordEvent = {
  kind: string
  tool?: string
  callId?: string
  path?: string
  detail?: string
  title?: string
  command?: string
  ok?: boolean
}

export type ExternalCliRecordInput = {
  runner: string
  prompt: string
  events: readonly ExternalCliRecordEvent[]
  answer: string
  settlement: PiTurnSettlement
  startedAt?: number
  finishedAt?: number
}

/**
 * Arguments a declared card can read.
 *
 * A CLI reports a path or a command, which is exactly what the file and shell
 * cards present. A tool the catalog does not know still records its call — it
 * simply falls back to a generic card, which is the contract.
 */
function argsFor(event: ExternalCliRecordEvent): Record<string, unknown> | undefined {
  const command = event.command || (event.tool === 'bash' ? event.detail : undefined)
  if (command) return { command }
  if (event.path) return { path: event.path }
  return undefined
}

export function buildExternalCliRecord(input: ExternalCliRecordInput): TurnRecord {
  const at = input.startedAt ?? Date.now()
  const finishedAt = input.finishedAt ?? at
  const entries: TurnRecordAppend[] = [
    {
      kind: 'turn-start',
      source: 'host',
      turn: 1,
      step: 1,
      at,
      runner: input.runner,
      capabilities: {
        parse: EXTERNAL_CLI_RUNNER_CAPABILITIES.parse,
        validateDoD: EXTERNAL_CLI_RUNNER_CAPABILITIES.validateDoD,
        iterate: EXTERNAL_CLI_RUNNER_CAPABILITIES.iterate,
      },
    },
    { kind: 'step-start', source: 'host', turn: 1, step: 1, at },
    { kind: 'user-text', source: 'user', content: input.prompt, turn: 1, step: 1, at },
  ]

  let call = 0
  for (const event of input.events) {
    if (event.kind !== 'tool' && event.kind !== 'file') continue
    call += 1
    const tool = event.tool || (event.kind === 'file' ? 'write' : 'tool')
    const callId = event.callId || `${input.runner}-${call}`
    const args = argsFor(event)
    entries.push({
      kind: 'tool-call',
      source: 'model',
      turn: 1,
      step: 1,
      at,
      tool,
      callId,
      ...(event.path ? { path: event.path } : {}),
      ...(args ? { args } : {}),
    })
    entries.push({
      kind: 'tool-result',
      source: 'host',
      turn: 1,
      step: 1,
      at,
      tool,
      callId,
      settlement: event.ok === false ? 'failed' : 'success',
      ...(event.detail ? { detail: event.detail } : {}),
    })
  }

  if (input.answer.trim()) {
    entries.push({ kind: 'assistant-text', source: 'model', content: input.answer, turn: 1, step: 1, at: finishedAt })
  }
  entries.push({ kind: 'step-end', source: 'host', turn: 1, step: 1, at: finishedAt })
  entries.push({ kind: 'turn-end', source: 'host', turn: 1, step: 1, at: finishedAt, settlement: input.settlement })
  return appendTurnRecord(undefined, entries)
}
