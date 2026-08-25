/**
 * The execution-process record, derived from the Turn Record.
 *
 * One pure function from what the Host recorded to the operation rows a run
 * summary shows. It replaces the four-source fallback ladder (live activity →
 * Host tool audit → toolCalls → steps+logs): four shapes, none canonical,
 * none able to prove another wrong, and the first one capped at 120 events —
 * so a long run lost its earliest operations exactly when it finished.
 *
 * Pure by contract — no I/O, no store reads, no clock, no randomness — because
 * it runs on live turns and on replayed records alike. Ordering comes from
 * `seq` and from nothing else. Card shapes come from each tool's own declared
 * presentation (ADR-0050), never from a filename regex.
 */
import { turnRecordEntries, type TurnRecord, type TurnRecordEntry } from './turnRecord.ts'
import {
  diffPaths,
  presentToolCall,
  presentToolResult,
  type ToolPresentation,
} from './tools/toolPresentation.ts'

export type RunOperationRow = {
  id: string
  seq: number
  turn: number
  step: number
  kind: 'tool' | 'error' | 'status' | 'notice'
  title: string
  detail?: string
  path?: string
  callId?: string
  ok?: boolean
  /** The tool's declared presentation, when this build and the record agree. */
  card?: ToolPresentation
}

export type ProducedFile = { path: string; action: 'create' | 'edit'; seq: number }

function base(entry: TurnRecordEntry) {
  return { id: `e${entry.seq}`, seq: entry.seq, turn: entry.turn, step: entry.step }
}

/** Row text from a declared card; falls back to the recorded names alone. */
/** Row text from a declared card; the caller owns the fallback title. */
function rowFromCard(
  card: ToolPresentation | undefined,
  fallbackTitle: string,
): { title?: string; detail?: string; path?: string } {
  if (!card) return {}
  switch (card.card) {
    case 'generic': {
      const firstPath = card.locations?.[0]?.path
      return {
        title: card.title || fallbackTitle,
        ...(card.content ? { detail: card.content } : {}),
        ...(firstPath ? { path: firstPath } : {}),
      }
    }
    case 'terminal':
      return { title: card.title || fallbackTitle, ...(card.description ? { detail: card.description } : {}) }
    case 'diff': {
      const firstPath = card.diffs[0]?.path
      return { title: card.title || fallbackTitle, ...(firstPath ? { path: firstPath } : {}) }
    }
    case 'search':
      return { title: card.title || fallbackTitle }
  }
}

/**
 * Operation rows for one record, in recorded order.
 *
 * Tool calls and their results merge into one row per callId, presented by
 * the tool's own declaration; boundary, approval, and compaction entries
 * render as status or notice rows. An entry this build cannot present — an
 * undeclared tool, malformed or older recorded arguments — becomes a plain
 * row, never an exception or a gap.
 */
export function projectRunOperations(record: TurnRecord | undefined): RunOperationRow[] {
  const rows: RunOperationRow[] = []
  const open = new Map<string, { call?: Extract<TurnRecordEntry, { kind: 'tool-call' }>; result?: Extract<TurnRecordEntry, { kind: 'tool-result' }> }>()
  const flushToolRow = (callId: string) => {
    const pair = open.get(callId)
    if (!pair?.call) return
    const result = pair.result
    const args = 'args' in pair.call ? pair.call.args : undefined
    const card =
      result
        ? (presentToolResult(pair.call.tool, args, {
            content: result.detail ?? '',
            isError: result.settlement !== 'success',
          }) ?? presentToolCall(pair.call.tool, args))
        : presentToolCall(pair.call.tool, args)
    const presented = rowFromCard(card, result ? `已執行 ${pair.call.tool}` : `執行 ${pair.call.tool}…`)
    const failed = Boolean(result && result.settlement !== 'success')
    rows.push({
      ...base(pair.call),
      kind: failed ? 'error' : 'tool',
      title: presented.title ?? (result ? `已執行 ${pair.call.tool}` : `執行 ${pair.call.tool}…`),
      callId: pair.call.callId,
      ...('path' in pair.call && pair.call.path ? { path: pair.call.path } : {}),
      ...(presented.path ? { path: presented.path } : {}),
      ...(result?.detail ? { detail: result.detail } : {}),
      ...(presented.detail ? { detail: presented.detail } : {}),
      ...(result ? { ok: !failed } : {}),
      ...(card ? { card } : {}),
    })
    open.delete(callId)
  }
  for (const entry of turnRecordEntries(record)) {
    switch (entry.kind) {
      case 'tool-call': {
        flushToolRow(entry.callId)
        open.set(entry.callId, { call: entry })
        break
      }
      case 'tool-result': {
        const pair = open.get(entry.callId)
        if (pair) {
          pair.result = entry
          flushToolRow(entry.callId)
        }
        else {
          // A result without a recorded call still reports; display never breaks replay.
          rows.push({
            ...base(entry),
            kind: entry.settlement === 'success' ? 'tool' : 'error',
            title: `${entry.tool} ${entry.settlement}`,
            ...(entry.detail ? { detail: entry.detail } : {}),
            ok: entry.settlement === 'success',
          })
        }
        break
      }
      case 'approval':
        rows.push({
          ...base(entry),
          kind: entry.decision === 'deny' ? 'error' : 'status',
          title: `${entry.tool}：${entry.decision}${entry.reason ? ` · ${entry.reason}` : ''}`,
          ok: entry.decision !== 'deny',
        })
        break
      case 'compaction':
        rows.push({ ...base(entry), kind: 'notice', title: `已壓縮 ${entry.replaced} 則上下文` })
        break
      case 'turn-start':
      case 'step-start':
      case 'assistant-text':
      case 'user-text':
      case 'reasoning':
        // Conversation content and boundaries belong to the conversation view.
        // Reasoning is named here on purpose: it is a kind this build knows
        // and deliberately leaves to the timeline, which is a different fact
        // from the unknown-entry notice the default arm writes.
        break
      case 'turn-end':
      case 'step-end':
        break
      default:
        rows.push({ ...base(entry), kind: 'notice', title: '未知的記錄項目' })
        break
    }
  }
  for (const [callId] of open) flushToolRow(callId)
  return [...rows].sort((left, right) => left.seq - right.seq)
}

/**
 * Files a run produced, from what tools declare they mutate.
 *
 * Only a successful declared mutation contributes its paths — a diff card's
 * diffs, or a generic card that declares `kind: 'edit'` with locations. Reads
 * and failed calls contribute nothing, so the list reflects what happened
 * rather than what was said. A file appears once per turn, at its first
 * mutation.
 */
export function projectProducedFiles(record: TurnRecord | undefined): ProducedFile[] {
  const files = new Map<string, ProducedFile>()
  const calls = new Map<string, Extract<TurnRecordEntry, { kind: 'tool-call' }>>()
  const pushMutation = (path: string, action: 'create' | 'edit', seq: number) => {
    if (!path.trim() || files.has(path)) return
    files.set(path, { path, action, seq })
  }
  for (const entry of turnRecordEntries(record)) {
    if (entry.kind === 'tool-call') {
      calls.set(entry.callId, entry)
      continue
    }
    if (entry.kind !== 'tool-result') continue
    if (entry.settlement !== 'success') continue
    const call = calls.get(entry.callId)
    if (!call) continue
    const args = 'args' in call ? call.args : undefined
    const card = presentToolCall(call.tool, args)
    if (!card) continue
    for (const mutation of diffPaths(card) ?? []) {
      pushMutation(mutation.path, mutation.action, entry.seq)
    }
    if (card.card === 'generic' && card.kind === 'edit') {
      for (const location of card.locations ?? []) {
        pushMutation(location.path, 'edit', entry.seq)
      }
    }
  }
  return [...files.values()].sort((left, right) => left.seq - right.seq)
}
