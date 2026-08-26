import { TURN_RECORD_FORMAT_VERSION, pageTurnRecord, type TurnRecordEntry, type TurnRecordPage } from '../src/agent/turnRecord.ts'

/**
 * Fixture ledger for the trajectory measurement pass (trajectory-review-closure
 * issue 03). Builds an in-memory Turn Record shaped exactly like a long run —
 * several entries per turn, timing and usage on every step-end.
 *
 * Paging is NOT re-implemented here: the loader delegates to the shipped
 * `pageTurnRecord`, so the measurement drives the exact same paged-read
 * contract as production (`before` exclusive upper `seq` bound, `nextBefore`,
 * `hasOlder`, `total`; limit clamped to TURN_RECORD_PAGE_SIZE like the Host).
 */

export type TrajectoryFixtureLoader = (sessionId: string, before?: number, limit?: number) => Promise<TurnRecordPage>

export function buildFixtureEntries(turns: number): TurnRecordEntry[] {
  const entries: TurnRecordEntry[] = []
  let seq = 0
  const nextSeq = () => ++seq
  for (let turn = 1; turn <= turns; turn += 1) {
    const at = turn * 1_000
    entries.push({ kind: 'step-start', source: 'host', turn, step: 1, seq: nextSeq(), at })
    entries.push({ kind: 'user-text', source: 'user', content: `問題 ${turn}：這是一列量測用的輸入`, turn, step: 1, seq: nextSeq(), at: at + 1 })
    entries.push({ kind: 'assistant-text', source: 'model', content: `回答 ${turn}：單行截斷的列，量測的是掛載數量而不是內容`, turn, step: 1, seq: nextSeq(), at: at + 2 })
    entries.push({
      kind: 'step-end',
      source: 'host',
      turn,
      step: 1,
      seq: nextSeq(),
      at: at + 3,
      timing: {
        waitingMs: 120 + (turn % 7) * 10,
        generatingMs: 900 + (turn % 13) * 25,
        totalMs: 1_020 + (turn % 11) * 30,
        usage: { input: 1_500 + turn, output: 320 + (turn % 9) * 11 },
      },
    })
  }
  return entries
}

export function createFixturePageLoader(turns: number): TrajectoryFixtureLoader {
  const record = { version: TURN_RECORD_FORMAT_VERSION, entries: buildFixtureEntries(turns) }
  return async (_sessionId: string, before?: number, limit?: number): Promise<TurnRecordPage> =>
    pageTurnRecord(record, { before, limit })
}
