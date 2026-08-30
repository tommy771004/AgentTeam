import type { ArchiveRecord } from './types.ts'
import {
  emptyUsageLedger,
  normalizeUsageLedger,
  usageEntryFromArchive,
  type UsageLedger,
  type UsageLedgerEntry,
} from './usageLedger.ts'

const BROWSER_KEY = 'subagents.usageLedger.v1'

function loadBrowserLedger(): UsageLedger {
  try {
    return normalizeUsageLedger(JSON.parse(localStorage.getItem(BROWSER_KEY) || 'null'))
  } catch {
    return emptyUsageLedger()
  }
}

function saveBrowserLedger(ledger: UsageLedger): void {
  try {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(ledger))
  } catch {
    /* restricted browser storage: keep usage reporting non-fatal */
  }
}

export async function loadUsageLedger(): Promise<UsageLedger> {
  const bridge = window.subagents?.usage
  if (bridge?.get) return normalizeUsageLedger(await bridge.get())
  return loadBrowserLedger()
}

export async function upsertUsageEntry(entry: UsageLedgerEntry): Promise<void> {
  const bridge = window.subagents?.usage
  if (bridge?.upsert) {
    await bridge.upsert(entry)
    return
  }
  const ledger = loadBrowserLedger()
  const entries = [entry, ...ledger.entries.filter((row) => row.runId !== entry.runId)]
    .sort((a, b) => Date.parse(b.settledAt) - Date.parse(a.settledAt))
  saveBrowserLedger({ ...ledger, entries })
}

export async function backfillUsageLedger(archive: ArchiveRecord[]): Promise<UsageLedger> {
  const current = await loadUsageLedger()
  if (current.backfillCompletedAt) return current
  for (const record of archive) {
    const entry = usageEntryFromArchive(record)
    if (entry) await upsertUsageEntry(entry)
  }
  const completedAt = new Date().toISOString()
  const bridge = window.subagents?.usage
  if (bridge?.completeBackfill) await bridge.completeBackfill(completedAt)
  else saveBrowserLedger({ ...(await loadUsageLedger()), backfillCompletedAt: completedAt })
  return loadUsageLedger()
}

export async function clearUsageLedger(): Promise<void> {
  const bridge = window.subagents?.usage
  if (bridge?.clear) {
    await bridge.clear()
    return
  }
  const now = new Date().toISOString()
  saveBrowserLedger({ ...emptyUsageLedger(now), backfillCompletedAt: now })
}
