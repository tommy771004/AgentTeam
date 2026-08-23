/**
 * The conversation, projected from the Turn Record.
 *
 * One pure function from what the Host recorded to what the renderer shows.
 * It exists so the chat is *derived* rather than *authored*: the renderer used
 * to compute an answer string itself and persist it, which made local storage
 * an authority ADR-0039 says it must never be, and let the visible answer
 * disagree with the Host's own account of the same turn.
 *
 * Pure by contract — no I/O, no store reads, no clock, no randomness — because
 * it runs on live turns and on replayed records alike.
 */
import { turnRecordEntries, type TurnRecord, type TurnRecordEntry } from './turnRecord.ts'

export type ConversationRow =
  | { kind: 'user'; id: string; seq: number; turn: number; content: string }
  | { kind: 'assistant'; id: string; seq: number; turn: number; content: string }
  | { kind: 'tool'; id: string; seq: number; turn: number; tool: string; callId: string; settlement?: string; detail?: string }
  | { kind: 'notice'; id: string; seq: number; turn: number; content: string }

/**
 * Rows for one record, in recorded order.
 *
 * An entry this build does not know how to render becomes a `notice` rather
 * than an exception or a gap: a record written by a newer build, or an older
 * one whose shape has moved on, must still show the conversation around it.
 * Display never breaks replay.
 */
export function projectConversationRows(record: TurnRecord | undefined): ConversationRow[] {
  const rows: ConversationRow[] = []
  for (const entry of turnRecordEntries(record)) {
    const base = { id: `e${entry.seq}`, seq: entry.seq, turn: entry.turn }
    switch (entry.kind) {
      case 'user-text':
        rows.push({ ...base, kind: 'user', content: entry.content })
        break
      case 'assistant-text':
        rows.push({ ...base, kind: 'assistant', content: entry.content })
        break
      case 'tool-call':
        rows.push({ ...base, kind: 'tool', tool: entry.tool, callId: entry.callId, ...(entry.path ? { detail: entry.path } : {}) })
        break
      case 'tool-result':
        rows.push({
          ...base,
          kind: 'tool',
          tool: entry.tool,
          callId: entry.callId,
          settlement: entry.settlement,
          ...(entry.detail ? { detail: entry.detail } : {}),
        })
        break
      case 'turn-start':
      case 'turn-end':
      case 'step-start':
      case 'step-end':
        break
      case 'approval':
        rows.push({ ...base, kind: 'notice', content: `${entry.tool}：${entry.decision}${entry.reason ? ` · ${entry.reason}` : ''}` })
        break
      case 'compaction':
        rows.push({ ...base, kind: 'notice', content: `已壓縮 ${entry.replaced} 則上下文` })
        break
      default:
        rows.push({ ...base, kind: 'notice', content: unknownEntryLabel(entry) })
        break
    }
  }
  return rows
}

function unknownEntryLabel(entry: TurnRecordEntry): string {
  const kind = (entry as { kind?: unknown }).kind
  return `未知的記錄項目：${typeof kind === 'string' ? kind : 'unknown'}`
}

/**
 * The answer a record settled on.
 *
 * The LAST assistant row, for the same reason the Host derives it that way: a
 * tool-using turn narrates before it works and concludes after, so the first
 * thing it said is the preamble, never the answer.
 */
export function conversationAnswer(record: TurnRecord | undefined): string | undefined {
  const answers = projectConversationRows(record).filter((row): row is Extract<ConversationRow, { kind: 'assistant' }> => row.kind === 'assistant')
  const last = answers[answers.length - 1]
  return last?.content.trim() ? last.content : undefined
}
