import {
  isWorkflowRecordEntry,
  workflowRecordContainsTranscript,
  type WorkflowRecordContext,
  type WorkflowRecordEntry,
  type WorkflowRecordEvent,
} from '../src/agent/workflowRecord.ts'

export type WorkflowRecordState = Readonly<{ version: 1; entries: readonly WorkflowRecordEntry[] }>
const MAX_WORKFLOW_RECORD_ENTRIES = 20_000

const cloneEntry = (entry: WorkflowRecordEntry): WorkflowRecordEntry =>
  Object.freeze(structuredClone(entry)) as WorkflowRecordEntry

export class WorkflowRecordStore {
  private entries: WorkflowRecordEntry[]
  private readonly onChange?: (state: WorkflowRecordState) => void
  private readonly clock: () => number

  constructor(
    state?: Partial<WorkflowRecordState>,
    onChange?: (state: WorkflowRecordState) => void,
    clock: () => number = Date.now,
  ) {
    const candidates = Array.isArray(state?.entries) ? state.entries : []
    const lastSequence = new Map<string, number>()
    this.entries = candidates.filter((entry) => {
      if (!isWorkflowRecordEntry(entry)) return false
      const prior = lastSequence.get(entry.workflowRunId)
      if (prior !== undefined && entry.workflowSeq !== prior + 1) return false
      lastSequence.set(entry.workflowRunId, entry.workflowSeq)
      return true
    }).slice(-MAX_WORKFLOW_RECORD_ENTRIES).map(cloneEntry)
    this.onChange = onChange
    this.clock = clock
  }

  append(context: WorkflowRecordContext, event: WorkflowRecordEvent): WorkflowRecordEntry {
    if (workflowRecordContainsTranscript(context) || workflowRecordContainsTranscript(event)) {
      throw new Error('Workflow Record accepts metadata refs only; transcript/reasoning payloads are forbidden')
    }
    const prior = this.entries.filter((entry) => entry.workflowRunId === context.workflowRunId)
    const entry = cloneEntry({ ...context, ...event, workflowSeq: (prior.at(-1)?.workflowSeq || 0) + 1, at: this.clock() } as WorkflowRecordEntry)
    if (!isWorkflowRecordEntry(entry)) throw new Error(`Invalid Workflow Record entry: ${event.kind}`)
    this.entries.push(entry)
    if (this.entries.length > MAX_WORKFLOW_RECORD_ENTRIES) this.entries = this.entries.slice(-MAX_WORKFLOW_RECORD_ENTRIES)
    this.onChange?.(this.snapshot())
    return entry
  }

  list(workflowRunId: string): readonly WorkflowRecordEntry[] {
    return this.entries.filter((entry) => entry.workflowRunId === workflowRunId).map(cloneEntry)
  }

  snapshot(): WorkflowRecordState {
    return Object.freeze({ version: 1 as const, entries: Object.freeze(this.entries.map(cloneEntry)) })
  }
}
