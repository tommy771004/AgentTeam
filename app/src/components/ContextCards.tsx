import type { ProcessOperation } from '../lib/runPresentation'

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path
}

/** Retrieved context presented as inspectable chunks instead of a raw log wall. */
export function ContextCards({ operations }: { operations: ProcessOperation[] }) {
  return (
    <div className="agent-context-cards">
      <div className="agent-context-heading">
        <span>All chunks</span>
        <span>{operations.length}</span>
      </div>
      {operations.map((operation, index) => {
        const source = operation.path || operation.title
        const excerpt = (operation.detail || operation.title).trim()
        return (
          <article
            key={operation.id}
            className="agent-context-card"
            style={{ animation: `fade-up 260ms cubic-bezier(0.23,1,0.32,1) ${index * 35}ms both` }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="agent-context-index">Chunk {index + 1}</span>
              <span className="agent-context-source min-w-0 truncate" title={source}>
                {operation.path ? basename(operation.path) : source}
              </span>
            </div>
            <p className="agent-context-copy">
              {excerpt.length > 260 ? `${excerpt.slice(0, 260)}…` : excerpt}
            </p>
            <div className="flex min-w-0 items-center gap-2 text-[10px] text-ink-3">
              <span className="agent-context-chip">{operation.kind}</span>
              {operation.path ? (
                <span
                  className="min-w-0 truncate font-[family-name:var(--font-mono)]"
                  title={operation.path}
                >
                  {operation.path}
                </span>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
