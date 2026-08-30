import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  canTransitionReviewComment,
  inheritReviewedFiles,
  rebaseReviewComment,
  type ReviewComment,
  type ReviewCommentAnchor,
  type ReviewCommentStatus,
  type ReviewFileState,
  type ReviewFeedbackBundle,
} from '../src/agent/reviewStateContract.ts'
import type { ReviewFileManifestEntry, ReviewWorkspaceBinding } from '../src/agent/reviewContract.ts'

export class ReviewStateStoreError extends Error {
  readonly code: 'not_found' | 'conflict' | 'invalid' | 'closed' | 'unsupported_schema'
  constructor(code: 'not_found' | 'conflict' | 'invalid' | 'closed' | 'unsupported_schema', message: string) {
    super(message)
    this.name = 'ReviewStateStoreError'
    this.code = code
  }
}

export interface ReviewStateStore {
  saveDraft(input: { id?: string; anchor: ReviewCommentAnchor; body: string; now?: string }): Promise<ReviewComment>
  deleteDraft(id: string): Promise<void>
  transitionComment(id: string, status: ReviewCommentStatus, now?: string): Promise<ReviewComment>
  listComments(snapshotId: string): Promise<ReviewComment[]>
  markReviewed(input: { snapshotId: string; path: string; contentHash: string; now?: string }): Promise<ReviewFileState>
  listFileStates(snapshotId: string): Promise<ReviewFileState[]>
  inheritSnapshot(input: { fromSnapshotId: string; toSnapshotId: string; nextManifest: ReviewFileManifestEntry[]; anchorCandidates: ReviewCommentAnchor[]; now?: string }): Promise<{ comments: ReviewComment[]; fileStates: ReviewFileState[] }>
  referencedSnapshotIds(): Promise<string[]>
  hardDeleteSnapshot(snapshotId: string): Promise<void>
  prepareFeedback(input: { snapshotId: string; threadId: string; workspace: ReviewWorkspaceBinding; now?: string }): Promise<ReviewFeedbackBundle>
  claimFeedback(id: string, runId: string): Promise<{ bundle: ReviewFeedbackBundle; claimed: boolean }>
  releaseFeedback(id: string, runId: string): Promise<void>
  close(): Promise<void>
}

function feedbackId(snapshotId: string, comments: ReviewComment[]): string {
  return `review_feedback_${createHash('sha256').update(JSON.stringify({ snapshotId, comments: comments.map((item) => ({ id: item.id, anchor: item.anchor, body: item.body, status: item.status, updatedAt: item.updatedAt })) })).digest('hex').slice(0, 24)}`
}

function assertDraftInput(anchor: ReviewCommentAnchor, body: string): void {
  if (!anchor.snapshotId || !anchor.path || !anchor.hunkFingerprint || !anchor.contextHash || !anchor.originalContext || !Number.isSafeInteger(anchor.line) || anchor.line < 1 || !body.trim()) {
    throw new ReviewStateStoreError('invalid', 'Complete comment anchor and body are required')
  }
}

export class InMemoryReviewStateStore implements ReviewStateStore {
  private comments = new Map<string, ReviewComment>()
  private fileStates = new Map<string, ReviewFileState>()
  private feedback = new Map<string, ReviewFeedbackBundle>()
  private closed = false
  private ensureOpen() { if (this.closed) throw new ReviewStateStoreError('closed', 'Review State Store is closed') }
  async saveDraft(input: { id?: string; anchor: ReviewCommentAnchor; body: string; now?: string }) {
    this.ensureOpen(); assertDraftInput(input.anchor, input.body)
    const now = input.now || new Date().toISOString()
    const current = input.id ? this.comments.get(input.id) : undefined
    if (current && current.status !== 'draft') throw new ReviewStateStoreError('conflict', 'Only draft comments may be edited')
    const comment: ReviewComment = { id: current?.id || input.id || randomUUID(), anchor: structuredClone(input.anchor), body: input.body.trim(), status: 'draft', createdAt: current?.createdAt || now, updatedAt: now }
    this.comments.set(comment.id, comment)
    return structuredClone(comment)
  }
  async deleteDraft(id: string) { this.ensureOpen(); const item = this.comments.get(id); if (!item) return; if (item.status !== 'draft') throw new ReviewStateStoreError('conflict', 'Submitted comments require lifecycle resolution'); this.comments.delete(id) }
  async transitionComment(id: string, status: ReviewCommentStatus, now = new Date().toISOString()) {
    this.ensureOpen(); const current = this.comments.get(id); if (!current) throw new ReviewStateStoreError('not_found', 'Review comment not found')
    if (!canTransitionReviewComment(current.status, status)) throw new ReviewStateStoreError('conflict', `Illegal review comment transition: ${current.status} -> ${status}`)
    const next = { ...current, status, updatedAt: now }; this.comments.set(id, next); return structuredClone(next)
  }
  async listComments(snapshotId: string) { this.ensureOpen(); return [...this.comments.values()].filter((item) => item.anchor.snapshotId === snapshotId).map((item) => structuredClone(item)) }
  async markReviewed(input: { snapshotId: string; path: string; contentHash: string; now?: string }) {
    this.ensureOpen(); if (!input.snapshotId || !input.path || !input.contentHash) throw new ReviewStateStoreError('invalid', 'snapshot, path, and content hash are required')
    const item: ReviewFileState = { snapshotId: input.snapshotId, path: input.path, contentHash: input.contentHash, state: 'reviewed', reviewedAt: input.now || new Date().toISOString() }
    this.fileStates.set(`${item.snapshotId}\0${item.path}`, item); return structuredClone(item)
  }
  async listFileStates(snapshotId: string) { this.ensureOpen(); return [...this.fileStates.values()].filter((item) => item.snapshotId === snapshotId).map((item) => structuredClone(item)) }
  async inheritSnapshot(input: { fromSnapshotId: string; toSnapshotId: string; nextManifest: ReviewFileManifestEntry[]; anchorCandidates: ReviewCommentAnchor[]; now?: string }) {
    this.ensureOpen(); const now = input.now || new Date().toISOString()
    const fileStates = inheritReviewedFiles({ ...input, reviewed: await this.listFileStates(input.fromSnapshotId), now })
    for (const item of fileStates) this.fileStates.set(`${item.snapshotId}\0${item.path}`, item)
    const comments = (await this.listComments(input.fromSnapshotId)).map((source) => {
      const comment = rebaseReviewComment(source, input.toSnapshotId, input.anchorCandidates, now)
      return { ...comment, id: `${source.id}@${input.toSnapshotId}`, sourceCommentId: source.id }
    })
    for (const comment of comments) if (comment.anchor.snapshotId === input.toSnapshotId || comment.status === 'outdated') this.comments.set(comment.id, comment)
    return { comments, fileStates }
  }
  async referencedSnapshotIds() { this.ensureOpen(); return [...new Set([...this.comments.values()].flatMap((item) => [item.anchor.snapshotId, item.rebasedFrom?.snapshotId].filter((value): value is string => Boolean(value))).concat([...this.fileStates.values()].map((item) => item.snapshotId), [...this.feedback.values()].map((item) => item.snapshotId)))] }
  async hardDeleteSnapshot(snapshotId: string) { this.ensureOpen(); for (const [id, item] of this.comments) if (item.anchor.snapshotId === snapshotId || item.rebasedFrom?.snapshotId === snapshotId) this.comments.delete(id); for (const [key, item] of this.fileStates) if (item.snapshotId === snapshotId) this.fileStates.delete(key); for (const [id, item] of this.feedback) if (item.snapshotId === snapshotId) this.feedback.delete(id) }
  async prepareFeedback(input: { snapshotId: string; threadId: string; workspace: ReviewWorkspaceBinding; now?: string }) { this.ensureOpen(); const comments = (await this.listComments(input.snapshotId)).filter((item) => item.status === 'submitted' || item.status === 'acknowledged'); if (!comments.length) throw new ReviewStateStoreError('invalid', 'At least one submitted review comment is required'); const id = feedbackId(input.snapshotId, comments); const existing = this.feedback.get(id); if (existing) return structuredClone(existing); const bundle: ReviewFeedbackBundle = { id, snapshotId: input.snapshotId, threadId: input.threadId, workspace: structuredClone(input.workspace), comments, createdAt: input.now || new Date().toISOString(), status: 'prepared' }; this.feedback.set(id, bundle); return structuredClone(bundle) }
  async claimFeedback(id: string, runId: string) { this.ensureOpen(); const current = this.feedback.get(id); if (!current) throw new ReviewStateStoreError('not_found', 'Review feedback bundle not found'); if (current.status === 'dispatched') return { bundle: structuredClone(current), claimed: false }; const bundle: ReviewFeedbackBundle = { ...current, status: 'dispatched', runId }; this.feedback.set(id, bundle); for (const frozen of current.comments) { const comment = this.comments.get(frozen.id); if (comment?.status === 'submitted') this.comments.set(comment.id, { ...comment, status: 'acknowledged', updatedAt: new Date().toISOString() }) } return { bundle: structuredClone(bundle), claimed: true } }
  async releaseFeedback(id: string, runId: string) { this.ensureOpen(); const current = this.feedback.get(id); if (current?.status === 'dispatched' && current.runId === runId) this.feedback.set(id, { ...current, status: 'prepared', runId: undefined }) }
  async close() { this.closed = true }
}

type CommentRow = { id: string; anchor_json: string; body: string; status: ReviewCommentStatus; created_at: string; updated_at: string; rebased_from_json: string | null; source_comment_id: string | null }
type FileStateRow = { snapshot_id: string; path: string; content_hash: string; state: ReviewFileState['state']; reviewed_at: string; inherited_from_snapshot_id: string | null }

export class SqliteReviewStateStore implements ReviewStateStore {
  private db: DatabaseSync
  private closed = false
  private constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version?: number }).user_version || 0)
    if (version > 2) { this.db.close(); throw new ReviewStateStoreError('unsupported_schema', `Review State schema v${version} is unsupported`) }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS review_comments(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, path TEXT NOT NULL, anchor_json TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rebased_from_json TEXT, source_comment_id TEXT);
      CREATE INDEX IF NOT EXISTS review_comments_snapshot ON review_comments(snapshot_id, path);
      CREATE TABLE IF NOT EXISTS review_file_states(snapshot_id TEXT NOT NULL, path TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL, reviewed_at TEXT NOT NULL, inherited_from_snapshot_id TEXT, PRIMARY KEY(snapshot_id, path));
      CREATE TABLE IF NOT EXISTS review_feedback_bundles(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, run_id TEXT);
      PRAGMA user_version = 1;
      COMMIT;`)
    const commentColumns = new Set((this.db.prepare('PRAGMA table_info(review_comments)').all() as Array<{ name: string }>).map((column) => column.name))
    if (!commentColumns.has('source_comment_id')) this.db.exec('ALTER TABLE review_comments ADD COLUMN source_comment_id TEXT;')
    this.db.exec('PRAGMA user_version = 2;')
  }
  static async open(path: string) { return new SqliteReviewStateStore(path) }
  private ensureOpen() { if (this.closed) throw new ReviewStateStoreError('closed', 'Review State Store is closed') }
  private rowComment(row: CommentRow): ReviewComment { return { id: row.id, anchor: JSON.parse(row.anchor_json), body: row.body, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.rebased_from_json ? { rebasedFrom: JSON.parse(row.rebased_from_json) } : {}), ...(row.source_comment_id ? { sourceCommentId: row.source_comment_id } : {}) } }
  async saveDraft(input: { id?: string; anchor: ReviewCommentAnchor; body: string; now?: string }) {
    this.ensureOpen(); assertDraftInput(input.anchor, input.body); const now = input.now || new Date().toISOString(); const id = input.id || randomUUID()
    const row = this.db.prepare('SELECT * FROM review_comments WHERE id = ?').get(id) as CommentRow | undefined
    if (row && row.status !== 'draft') throw new ReviewStateStoreError('conflict', 'Only draft comments may be edited')
    const item: ReviewComment = { id, anchor: input.anchor, body: input.body.trim(), status: 'draft', createdAt: row?.created_at || now, updatedAt: now }
    this.db.prepare('INSERT INTO review_comments(id,snapshot_id,path,anchor_json,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_id=excluded.snapshot_id,path=excluded.path,anchor_json=excluded.anchor_json,body=excluded.body,updated_at=excluded.updated_at').run(id, input.anchor.snapshotId, input.anchor.path, JSON.stringify(input.anchor), item.body, item.status, item.createdAt, now)
    return item
  }
  async deleteDraft(id: string) { this.ensureOpen(); const row = this.db.prepare('SELECT status FROM review_comments WHERE id = ?').get(id) as { status: ReviewCommentStatus } | undefined; if (!row) return; if (row.status !== 'draft') throw new ReviewStateStoreError('conflict', 'Submitted comments require lifecycle resolution'); this.db.prepare('DELETE FROM review_comments WHERE id = ?').run(id) }
  async transitionComment(id: string, status: ReviewCommentStatus, now = new Date().toISOString()) { this.ensureOpen(); const row = this.db.prepare('SELECT * FROM review_comments WHERE id = ?').get(id) as CommentRow | undefined; if (!row) throw new ReviewStateStoreError('not_found', 'Review comment not found'); if (!canTransitionReviewComment(row.status, status)) throw new ReviewStateStoreError('conflict', `Illegal review comment transition: ${row.status} -> ${status}`); this.db.prepare('UPDATE review_comments SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id); return this.rowComment({ ...row, status, updated_at: now }) }
  async listComments(snapshotId: string) { this.ensureOpen(); return (this.db.prepare('SELECT * FROM review_comments WHERE snapshot_id = ? ORDER BY created_at,id').all(snapshotId) as CommentRow[]).map((row) => this.rowComment(row)) }
  async markReviewed(input: { snapshotId: string; path: string; contentHash: string; now?: string }) { this.ensureOpen(); if (!input.snapshotId || !input.path || !input.contentHash) throw new ReviewStateStoreError('invalid', 'snapshot, path, and content hash are required'); const item: ReviewFileState = { snapshotId: input.snapshotId, path: input.path, contentHash: input.contentHash, state: 'reviewed', reviewedAt: input.now || new Date().toISOString() }; this.db.prepare('INSERT INTO review_file_states(snapshot_id,path,content_hash,state,reviewed_at) VALUES(?,?,?,?,?) ON CONFLICT(snapshot_id,path) DO UPDATE SET content_hash=excluded.content_hash,state=excluded.state,reviewed_at=excluded.reviewed_at').run(item.snapshotId, item.path, item.contentHash, item.state, item.reviewedAt); return item }
  async listFileStates(snapshotId: string) { this.ensureOpen(); return (this.db.prepare('SELECT * FROM review_file_states WHERE snapshot_id = ? ORDER BY path').all(snapshotId) as FileStateRow[]).map((row) => ({ snapshotId: row.snapshot_id, path: row.path, contentHash: row.content_hash, state: row.state, reviewedAt: row.reviewed_at, ...(row.inherited_from_snapshot_id ? { inheritedFromSnapshotId: row.inherited_from_snapshot_id } : {}) })) }
  async inheritSnapshot(input: { fromSnapshotId: string; toSnapshotId: string; nextManifest: ReviewFileManifestEntry[]; anchorCandidates: ReviewCommentAnchor[]; now?: string }) {
    this.ensureOpen(); const memory = new InMemoryReviewStateStore(); for (const item of await this.listFileStates(input.fromSnapshotId)) await memory.markReviewed(item); for (const comment of await this.listComments(input.fromSnapshotId)) await memory.saveDraft({ id: comment.id, anchor: comment.anchor, body: comment.body, now: comment.createdAt }).then(async () => { let status: ReviewCommentStatus = 'draft'; for (const next of ['submitted','acknowledged'] as const) { if (comment.status === status) break; await memory.transitionComment(comment.id, next, comment.updatedAt); status = next } })
    const inherited = await memory.inheritSnapshot(input)
    this.db.exec('BEGIN IMMEDIATE'); try { for (const item of inherited.fileStates) this.db.prepare('INSERT OR REPLACE INTO review_file_states(snapshot_id,path,content_hash,state,reviewed_at,inherited_from_snapshot_id) VALUES(?,?,?,?,?,?)').run(item.snapshotId,item.path,item.contentHash,item.state,item.reviewedAt,item.inheritedFromSnapshotId || null); for (const item of inherited.comments) if (item.anchor.snapshotId === input.toSnapshotId || item.status === 'outdated') this.db.prepare('INSERT INTO review_comments(id,snapshot_id,path,anchor_json,body,status,created_at,updated_at,rebased_from_json,source_comment_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET anchor_json=excluded.anchor_json,status=excluded.status,updated_at=excluded.updated_at,rebased_from_json=excluded.rebased_from_json').run(item.id,item.anchor.snapshotId,item.anchor.path,JSON.stringify(item.anchor),item.body,item.status,item.createdAt,item.updatedAt,item.rebasedFrom ? JSON.stringify(item.rebasedFrom) : null,item.sourceCommentId || null); this.db.exec('COMMIT') } catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error }
    return inherited
  }
  async referencedSnapshotIds() { this.ensureOpen(); const rows = this.db.prepare("SELECT snapshot_id FROM review_comments UNION SELECT snapshot_id FROM review_file_states UNION SELECT snapshot_id FROM review_feedback_bundles").all() as Array<{ snapshot_id: string }>; return rows.map((row) => row.snapshot_id) }
  async hardDeleteSnapshot(snapshotId: string) { this.ensureOpen(); this.db.exec('BEGIN IMMEDIATE'); try { this.db.prepare('DELETE FROM review_comments WHERE snapshot_id = ? OR rebased_from_json LIKE ?').run(snapshotId, `%${snapshotId}%`); this.db.prepare('DELETE FROM review_file_states WHERE snapshot_id = ?').run(snapshotId); this.db.prepare('DELETE FROM review_feedback_bundles WHERE snapshot_id = ?').run(snapshotId); this.db.exec('COMMIT') } catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error } }
  async prepareFeedback(input: { snapshotId: string; threadId: string; workspace: ReviewWorkspaceBinding; now?: string }) { this.ensureOpen(); const comments = (await this.listComments(input.snapshotId)).filter((item) => item.status === 'submitted' || item.status === 'acknowledged'); if (!comments.length) throw new ReviewStateStoreError('invalid', 'At least one submitted review comment is required'); const id = feedbackId(input.snapshotId, comments); const row = this.db.prepare('SELECT payload_json,status,run_id FROM review_feedback_bundles WHERE id=?').get(id) as { payload_json: string; status: ReviewFeedbackBundle['status']; run_id: string | null } | undefined; if (row) return { ...JSON.parse(row.payload_json) as ReviewFeedbackBundle, status: row.status, ...(row.run_id ? { runId: row.run_id } : {}) }; const bundle: ReviewFeedbackBundle = { id, snapshotId: input.snapshotId, threadId: input.threadId, workspace: input.workspace, comments, createdAt: input.now || new Date().toISOString(), status: 'prepared' }; this.db.prepare('INSERT INTO review_feedback_bundles(id,snapshot_id,payload_json,status) VALUES(?,?,?,?)').run(id,input.snapshotId,JSON.stringify(bundle),bundle.status); return bundle }
  async claimFeedback(id: string, runId: string) { this.ensureOpen(); this.db.exec('BEGIN IMMEDIATE'); try { const row = this.db.prepare('SELECT payload_json,status,run_id FROM review_feedback_bundles WHERE id=?').get(id) as { payload_json: string; status: ReviewFeedbackBundle['status']; run_id: string | null } | undefined; if (!row) throw new ReviewStateStoreError('not_found', 'Review feedback bundle not found'); const current = { ...JSON.parse(row.payload_json) as ReviewFeedbackBundle, status: row.status, ...(row.run_id ? { runId: row.run_id } : {}) }; if (row.status === 'dispatched') { this.db.exec('COMMIT'); return { bundle: current, claimed: false } } const bundle: ReviewFeedbackBundle = { ...current, status: 'dispatched', runId }; this.db.prepare('UPDATE review_feedback_bundles SET status=?,run_id=? WHERE id=?').run('dispatched',runId,id); const acknowledge = this.db.prepare("UPDATE review_comments SET status='acknowledged',updated_at=? WHERE id=? AND status='submitted'"); for (const comment of current.comments) acknowledge.run(new Date().toISOString(),comment.id); this.db.exec('COMMIT'); return { bundle, claimed: true } } catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error } }
  async releaseFeedback(id: string, runId: string) { this.ensureOpen(); this.db.prepare("UPDATE review_feedback_bundles SET status='prepared',run_id=NULL WHERE id=? AND status='dispatched' AND run_id=?").run(id,runId) }
  async close() { if (!this.closed) this.db.close(); this.closed = true }
}
