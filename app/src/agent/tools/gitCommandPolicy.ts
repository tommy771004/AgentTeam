/**
 * Settings → Git preferences, enforced on the shell command that will run.
 *
 * These preferences used to be applied renderer-side by the builtin `bash`
 * tool. When that tool moved to the Host (ADR-0027) the last caller went with
 * it and the preferences quietly stopped meaning anything: a user could switch
 * force-push off and the agent could still force-push. This module is the
 * enforcement, evaluated Host-side against the frozen run policy.
 *
 * Two different kinds of preference, deliberately handled differently:
 *
 *  - Additive ones (a branch prefix, `--draft`) are REWRITES. They add what the
 *    user asked for without changing what the command does.
 *  - A forbidden force push is a DENIAL, not a silent strip. Deleting `--force`
 *    would leave the model reading a success for a push that did not do what it
 *    asked — the command would appear to work while behaving differently. A
 *    refusal that names the setting is honest and actionable; a quiet rewrite
 *    of destructive intent is neither.
 */

export type GitCommandPolicy = Readonly<{
  /** Prefix new branches with this, when set. */
  branchPrefix?: string
  /** When false, a force push is refused rather than rewritten. */
  allowForcePush: boolean
  /** Add `--draft` to `gh pr create` when the user prefers draft PRs. */
  draftPr: boolean
}>

export type GitCommandDecision =
  | { action: 'allow' }
  | { action: 'rewrite'; command: string; note: string }
  | { action: 'deny'; reason: string }

const FORCE_PUSH = /\bgit\s+push\b[^;&|\n]*?\s--force(?:-with-lease)?\b/

/**
 * Decide what happens to one shell command under this run's Git preferences.
 *
 * The command is inspected, never parsed into a shell AST: this is a
 * preference layer, not a security boundary. Containment is the Outbound Data
 * Gate's job (ADR-0047/0051), and this runs before it so the gate inspects the
 * command that will actually execute.
 */
export function decideGitCommand(command: string, policy: GitCommandPolicy): GitCommandDecision {
  const original = String(command || '')
  if (!original.trim()) return { action: 'allow' }

  if (!policy.allowForcePush && FORCE_PUSH.test(original)) {
    return {
      action: 'deny',
      reason: 'Git 偏好：force push 已關閉（Settings → Git）。請改用一般 push，或先在 Settings 開啟後重試。',
    }
  }

  let rewritten = original
  const notes: string[] = []

  const prefix = (policy.branchPrefix || '').trim()
  if (prefix) {
    const before = rewritten
    rewritten = rewritten
      .replace(/\bgit\s+checkout\s+-b\s+(['"]?)([^\s;&|'"]+)\1/g, (whole, quote: string, name: string) =>
        needsPrefix(name, prefix) ? `git checkout -b ${quote}${prefix}${name}${quote}` : whole)
      .replace(/\bgit\s+switch\s+-c\s+(['"]?)([^\s;&|'"]+)\1/g, (whole, quote: string, name: string) =>
        needsPrefix(name, prefix) ? `git switch -c ${quote}${prefix}${name}${quote}` : whole)
      .replace(/\bgit\s+branch\s+(?!-)(['"]?)([A-Za-z0-9._/-]+)\1/g, (whole, quote: string, name: string) =>
        needsPrefix(name, prefix) ? `git branch ${quote}${prefix}${name}${quote}` : whole)
    if (rewritten !== before) notes.push(`branch prefix «${prefix}»`)
  }

  if (policy.draftPr && /\bgh\s+pr\s+create\b/.test(rewritten) && !/\s--draft\b/.test(rewritten)) {
    rewritten = rewritten.replace(/\bgh\s+pr\s+create\b/, 'gh pr create --draft')
    notes.push('draft PR')
  }

  return rewritten === original
    ? { action: 'allow' }
    : { action: 'rewrite', command: rewritten, note: `Git 偏好已套用：${notes.join('、')}` }
}

/**
 * A branch already carrying the prefix is left alone, and so is one that names
 * an explicit namespace of its own — prefixing `origin/main` or `feature/x`
 * would rename someone's deliberate choice rather than fill in a default.
 */
function needsPrefix(name: string, prefix: string): boolean {
  return Boolean(name) && !name.startsWith(prefix) && !name.includes('/')
}

/** The preferences this run froze, or undefined when Settings said nothing. */
export function gitCommandPolicyFromSettings(settings: {
  gitBranchPrefix?: string
  gitForcePush?: boolean
  gitCreateDraftPr?: boolean
}): GitCommandPolicy {
  return {
    ...(settings.gitBranchPrefix?.trim() ? { branchPrefix: settings.gitBranchPrefix.trim() } : {}),
    allowForcePush: settings.gitForcePush === true,
    draftPr: settings.gitCreateDraftPr !== false,
  }
}
