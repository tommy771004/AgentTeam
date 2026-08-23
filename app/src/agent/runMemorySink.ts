/**
 * What a finished run leaves behind for the next one.
 *
 * A checkpoint is disaster recovery; this is the opposite — the small set of
 * things worth knowing next time. Four sections, written as plain language a
 * non-engineer can read, dropped into the project's own memory directory so a
 * team can commit it and share it rather than each person re-learning it.
 *
 * The model never gets to say it remembered something. A sink exists only when
 * the file write succeeded and the journal recorded it (ADR-0048).
 */

export type RunMemorySection = 'objective' | 'decisions' | 'failures' | 'procedure'

export type RunMemoryDigest = {
  runId: string
  threadId: string
  at: string
  objective: string
  /** What was decided and why, in the user's language. */
  decisions: string[]
  /** What went wrong, so the next run does not walk into it again. */
  failures: string[]
  /** The repeatable steps, if this run found any. */
  procedure: string[]
}

/** Where a digest lands. One file per run, git-trackable. */
export function runMemoryRelativePath(digest: Pick<RunMemoryDigest, 'runId' | 'at'>): string {
  const day = (digest.at || '').slice(0, 10) || 'undated'
  const id = digest.runId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'run'
  return `.subagents/memory/runs/${day}-${id}.md`
}

const SECTION_TITLES: Record<RunMemorySection, string> = {
  objective: '這次要做什麼',
  decisions: '做了哪些決定',
  failures: '哪裡卡住或失敗',
  procedure: '下次可以照著做的步驟',
}

function section(title: string, lines: string[], empty: string): string {
  return `## ${title}\n\n${lines.length ? lines.map((line) => `- ${line}`).join('\n') : empty}\n`
}

/**
 * Render the digest as the file that lands in the project.
 *
 * Always four sections, even when one is empty: a missing section reads as an
 * omission, while "沒有" is a fact the next reader can rely on.
 */
export function renderRunMemoryDigest(digest: RunMemoryDigest): string {
  return [
    `# ${digest.objective.trim() || '（未命名任務）'}`,
    '',
    `> run ${digest.runId} · ${digest.at}`,
    '',
    `## ${SECTION_TITLES.objective}\n\n${digest.objective.trim() || '（沒有記錄目標）'}\n`,
    section(SECTION_TITLES.decisions, digest.decisions, '（這次沒有需要記下的決定）'),
    section(SECTION_TITLES.failures, digest.failures, '（這次沒有卡住的地方）'),
    section(SECTION_TITLES.procedure, digest.procedure, '（這次沒有整理出可重複的步驟）'),
  ].join('\n')
}

/** A digest is only worth writing when it says something. */
export function isWorthPersisting(digest: RunMemoryDigest): boolean {
  return Boolean(
    digest.objective.trim()
    && (digest.decisions.length || digest.failures.length || digest.procedure.length),
  )
}

/**
 * Prior context handed to the next run on the same thread.
 *
 * Deliberately short: this is a reminder of what already happened, not a
 * second transcript, and it must not crowd out the user's actual request.
 */
export function buildPriorContextBlock(digests: RunMemoryDigest[], limit = 3): string {
  const recent = digests.slice(-limit)
  if (!recent.length) return ''
  return [
    '## 這個對話先前的沉澱',
    '',
    ...recent.map((digest) => {
      const points = [...digest.decisions.slice(0, 2), ...digest.failures.slice(0, 1)]
      return [
        `### ${digest.objective.trim().slice(0, 120) || '（未命名任務）'}（${digest.at.slice(0, 10)}）`,
        ...(points.length ? points.map((point) => `- ${point}`) : ['- （沒有記下要點）']),
      ].join('\n')
    }),
    '',
    '以上取自先前執行留下的紀錄，供你參考；若與這次的要求衝突，以這次的要求為準。',
  ].join('\n')
}

/**
 * Evidence that a digest actually reached disk.
 *
 * The write result and the journal entry are the only acceptable proof; a
 * model asserting "已沉澱" without one of these is a claim, not an outcome.
 */
export type RunMemoryWriteEvidence = {
  ok: boolean
  path?: string
  bytes?: number
  error?: string
}

export function describeMemorySinkOutcome(evidence: RunMemoryWriteEvidence | null | undefined): string {
  if (!evidence) return '沒有沉澱（未嘗試寫入）'
  if (!evidence.ok) return `沉澱未寫入：${evidence.error || '原因不明'}`
  return `已沉澱到 ${evidence.path || '專案 memory 目錄'}`
}
