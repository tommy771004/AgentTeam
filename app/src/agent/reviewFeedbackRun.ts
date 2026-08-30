import type { ReviewFeedbackBundle } from './reviewStateContract.ts'
import type { ReviewTarget } from './reviewContract.ts'
import type { ExternalRunResult } from './taskRunTypes.ts'

function frozenFeedbackObjective(bundle: ReviewFeedbackBundle): string {
  const comments = bundle.comments.map((comment, index) => [
    `## Comment ${index + 1} · ${comment.id}`,
    `- file: ${comment.anchor.path}`,
    `- side/line: ${comment.anchor.side}:${comment.anchor.line}`,
    `- hunk fingerprint: ${comment.anchor.hunkFingerprint}`,
    `- context hash: ${comment.anchor.contextHash}`,
    `- original context:\n\`\`\`\n${comment.anchor.originalContext}\n\`\`\``,
    comment.body,
  ].join('\n')).join('\n\n')
  return `請依下列 Run Review feedback 修改程式碼。這是 Host 在 admission 前凍結的 comment bundle；不要改寫來源 attribution。\n\nSnapshot: ${bundle.snapshotId}\nWorkspace: ${bundle.workspace.workspaceId}\nBundle: ${bundle.id}\n\n${comments}`
}

export type ReviewFeedbackRunResult = {
  bundle: ReviewFeedbackBundle
  run: ExternalRunResult
  comparisonTarget?: Extract<ReviewTarget, { kind: 'snapshot-range' }>
}

/** Freeze the exact Host bundle the user will review before dispatch. */
export async function prepareReviewFeedback(snapshotId: string): Promise<ReviewFeedbackBundle> {
  const bridge = window.subagents?.piHost?.review
  if (typeof bridge?.prepareFeedback !== 'function') throw new Error('Pi Host review feedback preview bridge 不可用。')
  return (await bridge.prepareFeedback(snapshotId)).reviewFeedbackBundle
}

async function resolveFeedbackPreview(snapshotId: string, preview?: ReviewFeedbackBundle): Promise<ReviewFeedbackBundle> {
  const prepared = preview ?? await prepareReviewFeedback(snapshotId)
  if (prepared.snapshotId !== snapshotId || prepared.status !== 'prepared') throw new Error('Feedback preview 已過期或不屬於目前 snapshot。')
  return prepared
}

/** The sole review-feedback ingress; UI callers never dispatch a runner directly. */
export async function submitReviewFeedback(snapshotId: string, preview?: ReviewFeedbackBundle): Promise<ReviewFeedbackRunResult> {
  const bridge = window.subagents?.piHost?.review
  if (typeof bridge?.claimFeedback !== 'function') throw new Error('Pi Host review feedback bridge 不可用。')
  const prepared = await resolveFeedbackPreview(snapshotId, preview)
  const runId = `run_${prepared.id.slice(-24)}`
  const claim = await bridge.claimFeedback(prepared.id, runId)
  if (!claim.claimed) {
    return { bundle: claim.bundle, run: { path: 'builtin', status: 'skipped', error: '此 feedback bundle 已送出，略過重複提交。', threadId: claim.bundle.threadId, runId: claim.bundle.runId, skipped: true, skipReason: 'duplicate' } }
  }
  let runIngressEntered = false
  try {
    const [{ runTask }, { useThreadStore }] = await Promise.all([import('./taskRunCoordinator.ts'), import('../store/threadStore.ts')])
    const thread = useThreadStore.getState().threads.find((item) => item.id === claim.bundle.threadId)
    runIngressEntered = true
    const run = await runTask({
      runId,
      objective: frozenFeedbackObjective(claim.bundle),
      extraContext: JSON.stringify({ kind: 'review-feedback', bundle: claim.bundle }),
      sourceKind: 'review',
      sourceLabel: 'Run Review feedback',
      reuseThreadId: claim.bundle.threadId,
      runner: thread?.runner || 'builtin',
      projectRoot: claim.bundle.workspace.projectRoot,
      enqueueWhenBusy: true,
      skipUserBubble: false,
    })
    const afterSnapshotId = useThreadStore.getState().threads.find((item) => item.id === claim.bundle.threadId)?.bubbles
      .slice().reverse().find((bubble) => bubble.runSummary?.runId === runId)?.runSummary?.reviewSnapshotRef?.snapshotId
    if (afterSnapshotId) await bridge.inheritState?.(snapshotId, afterSnapshotId)
    return { bundle: claim.bundle, run, ...(afterSnapshotId ? { comparisonTarget: { kind: 'snapshot-range', beforeSnapshotId: snapshotId, afterSnapshotId } } : {}) }
  } catch (error) {
    if (!runIngressEntered) await bridge.releaseFeedback?.(claim.bundle.id, runId).catch(() => undefined)
    throw error
  }
}
