/**
 * How a tool presents — declared once, next to the tool, replayed forever.
 *
 * A tool's card in the feed must look like what the tool does: a command like
 * a terminal, an edit like a diff, a search like a search result. That
 * judgement belongs to the tool (the one place that knows), not to a central
 * filename regex guessing from titles.
 *
 * Both presenters run twice in a card's life: live, on streamed arguments,
 * and again later, on the Turn Record replay. They are therefore pure
 * functions of their inputs — no I/O, no session reads, no clock, no
 * randomness — and they never throw: a malformed or older recorded argument
 * returns `undefined` and degrades to a generic card instead of breaking the
 * view (ADR-0050).
 */

/** Where a tool touched the world, so produced files can be derived from intent. */
export type ToolLocation = { path: string; line?: number }

export type ToolPresentation =
  | {
      card: 'generic'
      title: string
      kind?: 'read' | 'search' | 'edit' | 'shell' | 'plan' | 'web'
      content?: string
      locations?: ToolLocation[]
    }
  | { card: 'terminal'; title: string; description?: string; cwd?: string }
  | {
      card: 'diff'
      title: string
      diffs: Array<{ path: string; oldText: string | null; newText: string }>
      locations?: ToolLocation[]
    }
  | { card: 'search'; shape: 'matches' | 'paths'; title: string; query?: string; truncated: boolean }

/** What a result presenter receives: the raw outcome, nothing rendered. */
export type ToolResultInput = { content: string; isError: boolean; meta?: unknown }

export type ToolPresenter = {
  presentCall?: (args: unknown) => ToolPresentation | undefined
  presentResult?: (args: unknown, result: ToolResultInput) => ToolPresentation | undefined
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

function asPath(value: unknown): string | undefined {
  const path = asText(value)
  return path && path.trim() ? path.trim() : undefined
}

function asLocations(value: unknown): ToolLocation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const locations = value
    .map((entry) => {
      const record = asRecord(entry)
      if (!record) return undefined
      const path = asPath(record.path)
      if (!path) return undefined
      const line = typeof record.line === 'number' && Number.isFinite(record.line) ? record.line : undefined
      return line === undefined ? { path } : { path, line }
    })
    .filter((entry): entry is ToolLocation => Boolean(entry))
  return locations.length > 0 ? locations : undefined
}

/** Edits arrive as `{edits:[{oldText,newText}]}` or a single `{oldText,newText}` pair. */
function editPairs(args: unknown): Array<{ oldText: string | null; newText: string }> | undefined {
  const record = asRecord(args)
  if (!record) return undefined
  const pairs: Array<{ oldText: string | null; newText: string }> = []
  if (Array.isArray(record.edits)) {
    for (const entry of record.edits) {
      const edit = asRecord(entry)
      const newText = asText(edit?.newText)
      if (!newText) continue
      pairs.push({ oldText: asText(edit?.oldText) ?? null, newText })
    }
  }
  else {
    const newText = asText(record.newText)
    if (newText) pairs.push({ oldText: asText(record.oldText) ?? null, newText })
  }
  return pairs.length > 0 ? pairs : undefined
}

/**
 * Card builders — the shared vocabulary presenters are written with.
 *
 * Each builder is pure, defensive, and returns `undefined` for arguments it
 * cannot honestly read. A tool's presenter calls one of these; a card shape
 * is never hand-rolled per call site.
 */

/** A file creation or full overwrite, presented as a one-sided diff. */
export function writeCard(args: unknown): ToolPresentation | undefined {
  const record = asRecord(args)
  const path = record ? asPath(record.path) : undefined
  const newText = record ? asText(record.content) : undefined
  if (!path || newText === undefined) return undefined
  return {
    card: 'diff',
    title: `已寫入 ${path.split(/[\\/]/).pop()}`,
    diffs: [{ path, oldText: null, newText }],
    locations: [{ path }],
  }
}

/** An in-place edit, presented as old→new pairs against one path. */
export function editCard(args: unknown): ToolPresentation | undefined {
  const record = asRecord(args)
  const path = record ? asPath(record.path) : undefined
  const diffs = editPairs(args)
  if (!path || !diffs) return undefined
  return {
    card: 'diff',
    title: `已編輯 ${path.split(/[\\/]/).pop()}`,
    diffs: diffs.map((pair) => ({ path, ...pair })),
    locations: [{ path }],
  }
}

/** A shell command, presented as what ran and where. */
export function terminalCard(args: unknown): ToolPresentation | undefined {
  const record = asRecord(args)
  if (!record) return undefined
  const command = asText(record.command)
  if (!command) return undefined
  const cwd = asPath(record.cwd)
  return { card: 'terminal', title: '已執行指令', ...(cwd ? { cwd } : {}), description: command }
}

/** A content search, presented as matched lines. */
export function searchMatchesCard(queryField: 'pattern' | 'query' = 'pattern') {
  return (args: unknown): ToolPresentation | undefined => {
    const record = asRecord(args)
    const pattern = record ? asText(record[queryField]) : undefined
    if (!pattern) return undefined
    return { card: 'search', shape: 'matches', query: pattern, title: `搜尋 ${pattern}`, truncated: false }
  }
}

/**
 * Presentations for the tools that flow through the Turn Record.
 *
 * These are Pi Core's builtin loop tools, whose schemas live in the vendored
 * package this app cannot annotate — so this module stands in as their
 * definition site, one entry per tool, each presenter calling a shared card
 * builder. Mutating tools declare diff cards from their own arguments, so a
 * produced-files list can be derived from what the tool says it changes —
 * whether or not the model remembered to mention the file (ADR-0050).
 */
const PI_BUILTIN_PRESENTATIONS: Record<string, ToolPresenter> = {
  write: { presentCall: writeCard },
  edit: { presentCall: editCard },
  bash: { presentCall: terminalCard },
  grep: {
    presentCall: searchMatchesCard(),
    presentResult: (args, result) => {
      // The result refines the call's own card — one declaration, one reading.
      const call = searchMatchesCard()(args)
      if (!call || call.card !== 'search') return call
      const meta = asRecord(result.meta)
      return { ...call, truncated: meta?.truncated === true }
    },
  },
  find: {
    presentCall: (args) => {
      const record = asRecord(args)
      const pattern = record ? asText(record.pattern) : undefined
      if (!pattern) return undefined
      return { card: 'search', shape: 'paths', query: pattern, title: `尋找 ${pattern}`, truncated: false }
    },
  },
  ls: {
    presentCall: (args) => {
      const record = asRecord(args)
      const path = record ? asPath(record.path) : undefined
      return {
        card: 'search',
        shape: 'paths',
        title: path ? `列出 ${path}` : '列出目錄',
        ...(path ? { query: path } : {}),
        truncated: false,
      }
    },
  },
  read: {
    presentCall: (args) => {
      const record = asRecord(args)
      if (!record) return undefined
      const path = asPath(record.path)
      if (!path) return undefined
      const line = typeof record.offset === 'number' && Number.isFinite(record.offset) ? record.offset : undefined
      return {
        card: 'generic',
        kind: 'read',
        title: `讀取 ${path.split(/[\\/]/).pop()}`,
        locations: [line === undefined ? { path } : { path, line }],
      }
    },
  },
}

/**
 * Look up a call's declared presentation, safely.
 *
 * An unknown tool has nothing to declare (`undefined`); a malformed argument
 * must degrade to the same generic fallback rather than break replay.
 */
export function presentToolCall(tool: string, args: unknown): ToolPresentation | undefined {
  const present = PI_BUILTIN_PRESENTATIONS[tool]?.presentCall
  if (!present) return undefined
  try {
    return present(args) ?? undefined
  } catch {
    return undefined
  }
}

/** Look up a result's declared presentation under the same contract. */
export function presentToolResult(tool: string, args: unknown, result: ToolResultInput): ToolPresentation | undefined {
  const present = PI_BUILTIN_PRESENTATIONS[tool]?.presentResult
  if (!present) return undefined
  try {
    return present(args, result) ?? undefined
  } catch {
    return undefined
  }
}

/** Paths a diff-card presentation mutates, with the action each one is. */
export function diffPaths(presentation: ToolPresentation): Array<{ path: string; action: 'create' | 'edit' }> | undefined {
  if (presentation.card !== 'diff') return undefined
  const paths: Array<{ path: string; action: 'create' | 'edit' }> = []
  for (const diff of presentation.diffs) {
    const path = asPath(diff.path)
    if (!path) continue
    paths.push({ path, action: diff.oldText === null ? 'create' : 'edit' })
  }
  return paths.length > 0 ? paths : undefined
}
