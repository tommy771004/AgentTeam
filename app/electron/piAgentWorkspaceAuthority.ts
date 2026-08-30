import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { AgentAdmissionSnapshot, AgentConflictEvent } from '../src/agent/agentCollaboration.ts'
import { isTerminalAgentLifecycle } from '../src/agent/agentLifecycle.ts'
import { projectAgentTree } from '../src/agent/agentTree.ts'
import { turnRecordEntries } from '../src/agent/turnRecord.ts'
import type { SessionRecord } from './piHostProtocol.ts'

type Workspace = AgentAdmissionSnapshot['workspace']
type Preparation = { ok: true; workspace: Workspace } | { ok: false; reason: string }
type LeaseDecision = { ok: true; revision: number } | { ok: false; conflict: AgentConflictEvent }

function canonicalExistingAncestor(path: string): { ancestor: string; suffix: string[] } | undefined {
  const suffix: string[] = []
  let cursor = path
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    suffix.unshift(basename(cursor))
    cursor = parent
  }
  return { ancestor: realpathSync(cursor), suffix }
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function canonicalScope(root: string, scope: string): string | undefined {
  if (!scope || isAbsolute(scope) || scope.split(/[\\/]/).includes('..')) return undefined
  const candidate = resolve(root, scope)
  const resolved = canonicalExistingAncestor(candidate)
  if (!resolved) return undefined
  const target = resolve(resolved.ancestor, ...resolved.suffix)
  if (!within(root, target)) return undefined
  return relative(root, target).split(sep).join('/') || '.'
}

function overlaps(left: string, right: string): boolean {
  return left === '.' || right === '.' || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function latestLifecycle(session: SessionRecord) {
  return [...turnRecordEntries(session.record)].reverse().find((entry) => entry.kind === 'agent-lifecycle')
}

function activeLease(session: SessionRecord): { root: string; scopes: string[]; revision: number } | undefined {
  const workspace = session.agentAdmission?.workspace
  if (!workspace || workspace.mode !== 'shared-leased-write' || session.archived) return undefined
  const lifecycle = latestLifecycle(session)
  if (lifecycle?.kind === 'agent-lifecycle' && isTerminalAgentLifecycle(lifecycle.event.state)) return undefined
  const events = turnRecordEntries(session.record).filter((entry) => entry.kind === 'agent-collaboration')
  const acquired = [...events].reverse().find((entry) => entry.event.type === 'lease-acquired')
  if (!acquired || acquired.kind !== 'agent-collaboration' || acquired.event.type !== 'lease-acquired') return undefined
  const acquiredRevision = acquired.event.revision
  const released = events.some((entry) => entry.event.type === 'lease-released' && entry.event.revision >= acquiredRevision)
  if (released || !workspace.projectRoot) return undefined
  return { root: workspace.projectRoot, scopes: [...workspace.scopes], revision: acquired.event.revision }
}

function nextRevision(sessions: readonly SessionRecord[]): number {
  return sessions.flatMap((session) => turnRecordEntries(session.record))
    .reduce((highest, entry) => entry.kind === 'agent-collaboration'
      && (entry.event.type === 'lease-acquired' || entry.event.type === 'lease-released' || entry.event.type === 'conflict')
      ? Math.max(highest, entry.event.type === 'conflict' ? entry.event.conflict.revision : entry.event.revision)
      : highest, 0) + 1
}

function conflictIdentity(input: { rootAgentId: string; requesterAgentId: string; ownerAgentId: string; resource: string; revision: number }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32)
}

export class PiAgentWorkspaceAuthority {
  prepare(input: Workspace, spawnId: string): Preparation {
    if (!input.projectRoot) {
      return input.mode === 'shared-readonly'
        ? { ok: true, workspace: { ...input, scopes: [], revision: 0 } }
        : { ok: false, reason: 'Write-capable workspace requires projectRoot' }
    }
    let projectRoot: string
    try {
      projectRoot = realpathSync(input.projectRoot)
    } catch {
      return { ok: false, reason: 'Workspace projectRoot is unavailable' }
    }
    if (input.mode === 'isolated-worktree') return this.createWorktree(projectRoot, spawnId)
    const scopes = input.scopes.map((scope) => canonicalScope(projectRoot, scope))
    if (scopes.some((scope) => !scope)) return { ok: false, reason: 'Workspace scope is not canonical project-relative' }
    if (input.mode === 'shared-leased-write' && scopes.length === 0) return { ok: false, reason: 'Shared writer requires at least one bounded scope' }
    return { ok: true, workspace: { ...input, projectRoot, scopes: scopes as string[], revision: input.revision } }
  }

  acquire(sessions: readonly SessionRecord[], agentId: string, workspace: Workspace): LeaseDecision {
    const revision = nextRevision(sessions)
    if (workspace.mode !== 'shared-leased-write') return { ok: true, revision }
    const tree = projectAgentTree({ sessions, agentId })
    if (!tree || !workspace.projectRoot) throw new Error('Agent tree or workspace root is unavailable')
    for (const owner of sessions) {
      if (owner.id === agentId) continue
      const lease = activeLease(owner)
      if (!lease || lease.root !== workspace.projectRoot) continue
      const resource = workspace.scopes.find((scope) => lease.scopes.some((owned) => overlaps(scope, owned)))
      if (!resource) continue
      const base = { rootAgentId: tree.rootAgentId, requesterAgentId: agentId, ownerAgentId: owner.id, resource, revision }
      return { ok: false, conflict: {
        conflictId: conflictIdentity(base), ...base,
        choices: ['serialize', 'narrow-scope', 'transfer-lease', 'release-lease', 'isolate-worktree', 'cancel'],
      } }
    }
    return { ok: true, revision }
  }

  assertWrite(session: SessionRecord, target: string): { ok: true } | { ok: false; reason: string } {
    const workspace = session.agentAdmission?.workspace
    if (!workspace) return { ok: true }
    if (workspace.mode === 'shared-readonly') return { ok: false, reason: 'Agent workspace is read-only' }
    if (!workspace.projectRoot || !isAbsolute(target)) return { ok: false, reason: 'Write target must be an absolute path in the admitted workspace' }
    if (workspace.mode === 'isolated-worktree') {
      if (!workspace.verified || !workspace.worktreePath) return { ok: false, reason: 'Isolated worktree identity is not verified' }
      const resolved = canonicalExistingAncestor(target)
      const canonicalTarget = resolved ? resolve(resolved.ancestor, ...resolved.suffix) : undefined
      return canonicalTarget && within(realpathSync(workspace.worktreePath), canonicalTarget)
        ? { ok: true }
        : { ok: false, reason: 'Write target escapes the verified isolated worktree' }
    }
    const canonical = canonicalScope(workspace.projectRoot, relative(workspace.projectRoot, target))
    if (!canonical) return { ok: false, reason: 'Write target escapes the admitted workspace' }
    return workspace.scopes.some((scope) => overlaps(scope, canonical))
      ? { ok: true }
      : { ok: false, reason: 'Write target is outside the leased scope' }
  }

  private createWorktree(projectRoot: string, spawnId: string): Preparation {
    try {
      const gitRoot = realpathSync(execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
      const baseline = execFileSync('git', ['-C', gitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      const slug = spawnId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'agent'
      const digest = createHash('sha256').update(spawnId).digest('hex').slice(0, 8)
      const branch = `agent/${slug}-${digest}`
      const container = resolve(dirname(gitRoot), '.agentstudio-worktrees', basename(gitRoot))
      const worktreePath = resolve(container, `${slug}-${digest}`)
      mkdirSync(container, { recursive: true })
      if (existsSync(worktreePath)) return { ok: false, reason: 'Isolated worktree path already exists' }
      execFileSync('git', ['-C', gitRoot, 'worktree', 'add', '-b', branch, worktreePath, baseline], { stdio: 'pipe' })
      const verifiedRoot = realpathSync(execFileSync('git', ['-C', worktreePath, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
      const verifiedBaseline = execFileSync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      if (verifiedRoot !== realpathSync(worktreePath) || verifiedBaseline !== baseline) {
        return { ok: false, reason: 'Isolated worktree verification failed' }
      }
      return { ok: true, workspace: {
        mode: 'isolated-worktree', projectRoot: gitRoot, worktreePath: verifiedRoot,
        branch, baseline, verified: true, scopes: ['.'], revision: 0,
      } }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? `Isolated worktree creation failed: ${error.message}` : 'Isolated worktree creation failed' }
    }
  }
}
