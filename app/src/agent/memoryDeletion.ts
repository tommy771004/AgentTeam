import type { MemoryProjectionScope } from './memoryProjection.ts'

export type MemoryClearIntent =
  | { operation: 'clear-project'; scope: Extract<MemoryProjectionScope, { kind: 'project' }> }
  | { operation: 'clear-global'; scope: Extract<MemoryProjectionScope, { kind: 'global' }> }
  | { operation: 'clear-all'; scope: { kind: 'all' } }

export const MEMORY_HARD_DELETE_LIMITATION =
  'SQLite secure_delete 與 WAL truncate checkpoint 為 best-effort；無法保證 SSD wear-leveling、備份或作業系統 snapshot 中的副本已抹除。'

export function memoryClearConfirmation(intent: MemoryClearIntent, count?: number): string {
  const boundedCount = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0
  if (intent.operation === 'clear-project') {
    return `確定清除目前專案記憶？\n專案：${intent.scope.project}\n此操作不可復原。`
  }
  if (intent.operation === 'clear-global') {
    return '確定清除一般全域記憶？\n不會影響任何專案記憶、USER profile 或 memory document。此操作不可復原。'
  }
  return `確定清除所有 scope 的記憶（共 ${boundedCount} 筆）？\n包含全域、所有專案、USER profile 與 memory document。此操作不可復原。`
}

export async function confirmMemoryClear(
  confirmAction: (message: string) => boolean,
  intent: MemoryClearIntent,
  count: number | undefined,
  execute: () => Promise<void>,
): Promise<boolean> {
  if (!confirmAction(memoryClearConfirmation(intent, count))) return false
  await execute()
  return true
}
