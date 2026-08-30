import type { TimelineItem } from './RunTimelineList'

export type TimelineToolKind = 'search' | 'edit' | 'read' | 'command' | 'tool'

export type TimelineDisplayEntry =
  | { type: 'single'; row: TimelineItem; index: number }
  | { type: 'group'; id: string; key: string; rows: TimelineItem[]; index: number }

export function timelineToolKind(tool: string): TimelineToolKind {
  if (/(?:search|grep|glob|find|web|fetch|browser)/i.test(tool)) return 'search'
  if (/(?:write|edit|patch|create|replace)/i.test(tool)) return 'edit'
  if (/(?:read|view|open|image)/i.test(tool)) return 'read'
  if (/(?:bash|shell|exec|run|command|terminal)/i.test(tool)) return 'command'
  return 'tool'
}

function toolState(row: Extract<TimelineItem, { kind: 'tool' }>): 'pending' | 'success' | 'failed' {
  if (row.settlement === undefined) return 'pending'
  return row.settlement === 'success' ? 'success' : 'failed'
}

function activityGroupKey(row: TimelineItem): string | null {
  switch (row.kind) {
    case 'reasoning': return 'reasoning'
    case 'context': return 'context'
    case 'tool': return `tool:${timelineToolKind(row.tool)}:${toolState(row)}`
    case 'assistant':
    case 'notice':
      return null
  }
}

function normalizedCommand(row: TimelineItem): string | null {
  if (row.kind !== 'tool' || timelineToolKind(row.tool) !== 'command') return null
  const command = row.detail?.trim().replace(/\r\n?/g, '\n')
  return command || null
}

function appendUniqueActivity(grouped: TimelineItem[], seenCommands: Set<string>, row: TimelineItem): void {
  const command = normalizedCommand(row)
  if (command && seenCommands.has(command)) return
  if (command) seenCommands.add(command)
  grouped.push(row)
}

/**
 * Collapse only adjacent activities with the same semantic presentation kind.
 * Prose and notices are hard boundaries, so grouping can never reorder the
 * canonical Turn Record or hide a failure among successful operations.
 */
export function groupTimelineItems(rows: readonly TimelineItem[]): TimelineDisplayEntry[] {
  const entries: TimelineDisplayEntry[] = []
  let cursor = 0

  while (cursor < rows.length) {
    const row = rows[cursor]
    const key = activityGroupKey(row)
    if (!key) {
      entries.push({ type: 'single', row, index: cursor })
      cursor += 1
      continue
    }

    const grouped: TimelineItem[] = []
    const seenCommands = new Set<string>()
    appendUniqueActivity(grouped, seenCommands, row)
    let next = cursor + 1
    while (next < rows.length && activityGroupKey(rows[next]) === key) {
      appendUniqueActivity(grouped, seenCommands, rows[next])
      next += 1
    }

    if (grouped.length === 1) {
      entries.push({ type: 'single', row, index: cursor })
    } else {
      entries.push({
        type: 'group',
        id: `timeline-group:${key}:${row.id}`,
        key,
        rows: grouped,
        index: cursor,
      })
    }
    cursor = next
  }

  return entries
}
