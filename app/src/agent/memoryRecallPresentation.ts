import type { TurnRecordEntry } from './turnRecord.ts'

type MemoryRecallEntry = Extract<TurnRecordEntry, { kind: 'memory-recall' }>

export function formatMemoryRecallNotice(entry: MemoryRecallEntry): string {
  return `已召回 ${entry.items.length} 則長期記憶（revision ${entry.revision}）`
}
