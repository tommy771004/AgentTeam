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
 * `seq` and from nothing else.
 */
import { turnRecordEntries, type TurnRecord, type TurnRecordEntry } from './turnRecord.ts'

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
}

export type ProducedFile = { path: string; action: 'create' | 'edit'; seq: number }

function base(entry: TurnRecordEntry) {
  return { id: `e${entry.seq}`, seq: entry.seq, turn: entry.turn, step: entry.step }
}

/**
 * Operation rows for one record, in recorded order.
 *
 * Tool calls and their results merge into one row per callId; boundary,
 * approval, and compaction entries render as status or notice rows. An entry
 * this build cannot present becomes a notice, never an exception or a gap.
 */
export function projectRunOperations(record: TurnRecord | undefined): RunOperationRow[] {
  const rows: RunOperationRow[] = []
  const open = new Map<string, { call?: Extract<TurnRecordEntry, { kind: 'tool-call' }>; result?: Extract<TurnRecordEntry, { kind: 'tool-result' }> }>()
  const flushToolRow = (callId: string) => {
    const pair = open.get(callId)
    if (!pair?.call) return
    const result = pair.result
    rows.push({
      ...base(pair.call),
      kind: result && result.settlement !== 'success' ? 'error' : 'tool',
      title: result ? `已執行 ${pair.call.tool}` : `執行 ${pair.call.tool}…`,
      callId: pair.call.callId,
      ...(result?.detail ? { detail: result.detail } : {}),
      ...(pair.call.path ? { path: pair.call.path } : {}),
      ...(result ? { ok: result.settlement === 'success' } : {}),
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
        // Conversation content and boundaries belong to the conversation view.
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
 * Files a run produced, from mutating results only.
 *
 * A write/edit whose result settled successfully contributes its path once;
 * reads and failed calls contribute nothing, so the list reflects what
 * happened rather than what was said.
 */
export function projectProducedFiles(record: TurnRecord | undefined): ProducedFile[] {
  const files = new Map<string, ProducedFile>()
  const calls = new Map<string, Extract<TurnRecordEntry, { kind: 'tool-call' }>>()
  for (const entry of turnRecordEntries(record)) {
    if (entry.kind === 'tool-call') {
      calls.set(entry.callId, entry)
      continue
    }
    if (entry.kind !== 'tool-result') continue
    if (entry.settlement !== 'success') continue
    const call = calls.get(entry.callId)
    const isMutation = call ? /write|edit|create|patch/i.test(call.tool) : false
    const path = call?.path
    if (!isMutation || !path || !path.trim()) continue
    const action = call && /write|create/i.test(call.tool) ? 'create' : 'edit'
    if (!files.has(path)) files.set(path, { path, action, seq: entry.seq })
  }
  return [...files.values()].sort((left, right) => left.seq - right.seq)
}
