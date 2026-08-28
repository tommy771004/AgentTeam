type DiffLineKind = 'add' | 'remove' | 'hunk' | 'header' | 'context'

type DiffLine = {
  text: string
  kind: DiffLineKind
  oldLine?: number
  newLine?: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function diffLines(diff: string): DiffLine[] {
  let oldLine: number | undefined
  let newLine: number | undefined

  return diff.split('\n').map((text) => {
    const hunk = text.match(HUNK_HEADER)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { text, kind: 'hunk' }
    }
    if (text.startsWith('--- ') || text.startsWith('+++ ') || text.startsWith('diff ') || text.startsWith('index ')) {
      return { text, kind: 'header' }
    }
    if (text.startsWith('-')) {
      const line = { text, kind: 'remove' as const, oldLine }
      if (oldLine !== undefined) oldLine++
      return line
    }
    if (text.startsWith('+')) {
      const line = { text, kind: 'add' as const, newLine }
      if (newLine !== undefined) newLine++
      return line
    }
    const line = { text, kind: 'context' as const, oldLine, newLine }
    if (oldLine !== undefined) oldLine++
    if (newLine !== undefined) newLine++
    return line
  })
}

function lineTone(kind: DiffLineKind): string {
  switch (kind) {
    case 'add': return 'bg-green-tint text-green'
    case 'remove': return 'bg-red-tint text-red'
    case 'hunk': return 'bg-accent-tint text-accent-ink'
    case 'header': return 'bg-inset text-ink-3'
    case 'context': return 'text-ink-2'
  }
}

/** A shared, line-numbered renderer for durable tool diffs and final Git diff. */
export function UnifiedDiffView({
  diff,
  emptyText = '沒有偵測到工作樹變更。',
  maxHeightClass = 'max-h-[360px]',
  testId,
}: {
  diff: string
  emptyText?: string
  maxHeightClass?: string
  testId?: string
}) {
  if (!diff.trim()) {
    return <div data-testid={testId} className="px-3 py-2.5 text-[11px] text-ink-3">{emptyText}</div>
  }

  // Patch headers are useful to the parser (especially the hunk's starting
  // line numbers), but they are transport metadata rather than source code.
  // Keep them out of the product surface and show only the lines a reader can
  // act on: unchanged context, removals, and additions.
  const visibleLines = diffLines(diff).filter((line) => line.kind !== 'header' && line.kind !== 'hunk')

  return (
    <div
      data-testid={testId}
      className={`${maxHeightClass} overflow-auto bg-inset font-[family-name:var(--font-mono)] text-[11px] leading-[1.65] custom-scrollbar`}
      role="region"
      aria-label="程式碼差異"
    >
      <div className="min-w-max py-1.5">
        {visibleLines.map((line, index) => (
          <div key={`${index}:${line.text}`} data-diff-line={line.kind} className={`grid grid-cols-[3.25rem_3.25rem_minmax(0,1fr)] ${lineTone(line.kind)}`}>
            <span className="select-none border-r border-line/70 px-2 text-right text-ink-3/70 tabular-nums">{line.oldLine}</span>
            <span className="select-none border-r border-line/70 px-2 text-right text-ink-3/70 tabular-nums">{line.newLine}</span>
            <span className="whitespace-pre px-3">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
