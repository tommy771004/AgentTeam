/**
 * Presentation-only grouping for an agent turn.
 *
 * Execution sources do not all expose the same event protocol, so this keeps
 * the UI semantic without changing the runner / persistence contracts.
 */

export type ProcessOperation = {
  id: string
  kind: string
  title: string
  detail?: string
  path?: string
  ok?: boolean
  /** Diff size for write/edit calls, from the tool's own declared card. */
  added?: number
  removed?: number
}

export type ProcessOperationGroup =
  | {
      type: 'context'
      id: string
      operations: ProcessOperation[]
    }
  | {
      type: 'operation'
      id: string
      operation: ProcessOperation
    }

const CONTEXT_OPERATION =
  /\b(read|cat|glob|grep|rg|search|list|find|ls|tree|codegraph|web[_ -]?search|http_fetch)\b/i

/** Context work: compact consecutive read/search operations. */
export function isContextOperation(operation: ProcessOperation) {
  if (operation.kind !== 'tool' && operation.kind !== 'status') return false
  return CONTEXT_OPERATION.test(`${operation.title}\n${operation.detail || ''}`)
}

export function groupProcessOperations(operations: ProcessOperation[]): ProcessOperationGroup[] {
  const groups: ProcessOperationGroup[] = []
  let context: ProcessOperation[] = []

  const flushContext = () => {
    if (!context.length) return
    groups.push({
      type: 'context',
      id: `context_${context[0].id}`,
      operations: context,
    })
    context = []
  }

  for (const operation of operations) {
    if (isContextOperation(operation)) {
      context.push(operation)
      continue
    }
    flushContext()
    groups.push({ type: 'operation', id: operation.id, operation })
  }
  flushContext()
  return groups
}

export function contextSummary(operations: ProcessOperation[]) {
  const labels = operations.map((operation) => {
    const haystack = `${operation.title}\n${operation.detail || ''}`
    if (/\b(read|cat)\b/i.test(haystack)) return '讀取'
    if (/\b(glob|grep|rg|search|find)\b/i.test(haystack)) return '搜尋'
    return '列出'
  })
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1)
  return [...counts.entries()]
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ')
}
