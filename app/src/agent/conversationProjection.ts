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
import { formatMemoryRecallNotice } from './memoryRecallPresentation.ts'
import { presentedToolSummary } from './tools/toolPresentation.ts'

export type ConversationRow =
  | { kind: 'user'; id: string; seq: number; turn: number; content: string }
  | { kind: 'assistant'; id: string; seq: number; turn: number; content: string }
  /**
   * What the model thought, in the place it thought it.
   *
   * A row of its own rather than a decoration on the next one: the reader's
   * question is «這個工具呼叫之前它在想什麼», and only an interleaved row can
   * answer it. It carries the thought whole — a view may collapse it, but the
   * projection never shortens it.
   */
  | { kind: 'reasoning'; id: string; seq: number; turn: number; content: string }
  | {
      kind: 'tool'
      id: string
      seq: number
      turn: number
      tool: string
      callId: string
      settlement?: string
      /** Host-authored terminal detail, kept separate from the invocation target. */
      resultDetail?: string
      detail?: string
      /** Durable code diff declared by the mutating tool call. */
      diff?: string
      /** The tool's own declared title and diff size, when it declares them. */
      title?: string
      added?: number
      removed?: number
      /** The approval decision that rode this invocation's line. */
      approval?: string
      approvalReason?: string
    }
  | { kind: 'notice'; id: string; seq: number; turn: number; content: string }

type ToolCallEntry = Extract<TurnRecordEntry, { kind: 'tool-call' }>
type ApprovalEntry = Extract<TurnRecordEntry, { kind: 'approval' }>

const NON_CONVERSATION_ENTRY_KINDS = new Set<TurnRecordEntry['kind']>([
  'provider-prompt',
  'provider-history',
  'tool-evidence',
  'state-proposal',
  'state-check',
  'working-state',
  'delegation-assignment',
  'delegation-observation',
  'delegation-check',
  'memory-control-package',
  'memory-control-lifecycle',
  'skill-invocation',
  'skill-context',
])

function conversationToolCallRow(entry: ToolCallEntry): Extract<ConversationRow, { kind: 'tool' }> {
  const presented = presentedToolSummary(entry.tool, 'args' in entry ? entry.args : undefined)
  return {
    id: `e${entry.seq}`,
    seq: entry.seq,
    turn: entry.turn,
    kind: 'tool',
    tool: entry.tool,
    callId: entry.callId,
    ...(entry.path ? { detail: entry.path } : {}),
    ...(presented?.title ? { title: presented.title } : {}),
    ...(presented?.path && !entry.path ? { detail: presented.path } : {}),
    ...(presented?.diff ? { diff: presented.diff } : {}),
    ...(presented?.added !== undefined ? { added: presented.added } : {}),
    ...(presented?.removed !== undefined ? { removed: presented.removed } : {}),
  }
}

function applyApprovalRow(rows: ConversationRow[], entry: ApprovalEntry): void {
  const anchor = rows.find((row) => row.kind === 'tool' && row.callId === entry.callId)
  if (anchor?.kind === 'tool') {
    anchor.approval = entry.decision
    if (entry.reason) anchor.approvalReason = entry.reason
    return
  }
  rows.push({
    id: `e${entry.seq}`,
    seq: entry.seq,
    turn: entry.turn,
    kind: 'notice',
    content: `${entry.tool}：${entry.decision}${entry.reason ? ` · ${entry.reason}` : ''}`,
  })
}

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
    if (NON_CONVERSATION_ENTRY_KINDS.has(entry.kind)) continue
    const base = { id: `e${entry.seq}`, seq: entry.seq, turn: entry.turn }
    switch (entry.kind) {
      case 'user-text':
        rows.push({ ...base, kind: 'user', content: entry.content })
        break
      case 'assistant-text':
        rows.push({ ...base, kind: 'assistant', content: entry.content })
        break
      case 'reasoning':
        rows.push({ ...base, kind: 'reasoning', content: entry.content })
        break
      case 'tool-call': {
        // The call row carries what the tool declares about itself — title,
        // path, diff size — so a view merging call and result still shows
        // 「已編輯 x.ts +10 −0」 while the call is the only half recorded.
        // An undeclared or malformed call degrades to the plain name.
        rows.push(conversationToolCallRow(entry))
        break
      }
      case 'tool-result':
        rows.push({
          ...base,
          kind: 'tool',
          tool: entry.tool,
          callId: entry.callId,
          settlement: entry.settlement,
          ...(entry.detail ? { resultDetail: entry.detail } : {}),
        })
        break
      case 'turn-start':
      case 'turn-end':
      case 'step-start':
      case 'step-end':
        break
      case 'approval': {
        // The decision belongs on the invocation's own line: same callId, one
        // action, one row. It always follows the call it decided, so the first
        // tool row with that callId is the anchor — on a live page and on a
        // replayed one alike. A decision with no recorded call (an older
        // build's record, a transport gap) still reports, as a notice.
        applyApprovalRow(rows, entry)
        break
      }
      case 'compaction':
        rows.push({ ...base, kind: 'notice', content: `已壓縮 ${entry.replaced} 則上下文` })
        break
      case 'memory-recall':
        rows.push({ ...base, kind: 'notice', content: formatMemoryRecallNotice(entry) })
        break
      case 'notice':
        // The entry kind whose whole purpose is to be read. It used to fall
        // through to the unknown arm and surface as 「未知的記錄項目：notice」,
        // which hid the very fact it was written to show — a skills-unavailable
        // warning, say. A known kind reaching that arm is the guard misfiring,
        // not graceful degradation.
        rows.push({ ...base, kind: 'notice', content: entry.text })
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
 *
 * Reasoning rows are deliberately not eligible. A thought is not an answer,
 * however confidently it ends, and letting one become the published answer
 * would put words in the model's mouth that it chose not to say.
 */
export function conversationAnswer(record: TurnRecord | undefined): string | undefined {
  const answers = projectConversationRows(record).filter((row): row is Extract<ConversationRow, { kind: 'assistant' }> => row.kind === 'assistant')
  const last = answers[answers.length - 1]
  return last?.content.trim() ? last.content : undefined
}
