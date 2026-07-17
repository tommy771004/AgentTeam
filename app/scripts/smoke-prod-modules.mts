/**
 * Production-module smoke — import real TS sources (not mirrored logic).
 * Catches drift when smoke.mjs / smoke-caps.mjs re-implementations diverge.
 *
 * Run: node --experimental-strip-types scripts/smoke-prod-modules.mts
 * Via: npm run smoke:ci
 */
import assert from 'node:assert/strict'
import {
  resolveEffectiveProjectRoot,
} from '../src/agent/tools/runContext.ts'
import {
  compileToolPackage,
  effectiveOperationClass,
  packageFingerprint,
  validateToolPackage,
  type ToolPackageManifest,
  type ToolPackageTool,
} from '../src/agent/tools/toolPackage.ts'
import {
  firstExecutablePath,
  isPathInside,
  quoteShellArg,
  shellCommandSpec,
} from '../electron/platformProcess.ts'
import {
  imagePixelCountFromDataUrl,
  isVisionImageTooSmall,
} from '../electron/attachmentStore.ts'
import { useRunActivityStore } from '../src/store/runActivityStore.ts'
import { usePermissionAskStore } from '../src/store/permissionAskStore.ts'
import {
  classifyLoopType,
  detectAutomationSuggestion,
  formatPlanBubble,
  parseUserRequest,
  resolvePlanBubbleMetadata,
} from '../src/agent/parser.ts'
import {
  normalizeTaskRunInput,
  runTask,
} from '../src/agent/taskRunCoordinator.ts'
import {
  buildContextPacket,
  formatSessionRecallBlock,
} from '../src/agent/hermes/contextPacket.ts'
import { scoreQueryText } from '../src/agent/hermes/textSimilarity.ts'
import {
  EXTERNAL_CLI_DOD_LABEL,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
  BUILTIN_RUNNER_CAPABILITIES,
  capabilitiesForRunner,
  formatCliContinueGoalPrompt,
  isCompleteCliContinueGoalContract,
} from '../src/agent/runners/types.ts'
import {
  advanceJobAfterRun,
  createScheduleTriggerSnapshot,
  isClaimedScheduleTrigger,
  jobIsDue,
  validateScheduleTriggerSnapshot,
} from '../src/agent/scheduler.ts'
import {
  createPublishScheduleLedger,
  createPersistentPublishScheduleLedger,
} from '../src/agent/contentPublishing.ts'
import { useContentItemStore } from '../src/store/contentItemStore.ts'
import { useContentPublishStore } from '../src/store/contentPublishStore.ts'
import { createContentPublishAdapterRegistry } from '../src/agent/contentPublishAdapters.ts'
import {
  CONTENT_PUBLISH_PROVIDERS,
  composePublishText,
  contentPublishProvider,
} from '../src/agent/contentPublishPlatforms.ts'

// Node 25 exposes experimental Web Storage without getItem/setItem unless a
// --localstorage-file is supplied. Keep this production-module smoke isolated
// and deterministic without changing renderer storage behavior.
const smokeStorage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => smokeStorage.get(key) ?? null,
    setItem: (key: string, value: string) => smokeStorage.set(key, value),
    removeItem: (key: string) => smokeStorage.delete(key),
    clear: () => smokeStorage.clear(),
  },
})
import {
  matchProactiveEvent,
  validateEventTriggerSnapshot,
} from '../src/agent/eventMatcher.ts'
import { consumeNextState } from '../src/agent/outcomeDispatcher.ts'
import { deriveSubDesignWorkspace } from '../src/agent/subdesign/workspace.ts'
import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignCritiqueSession } from '../src/agent/subdesign/types.ts'
import type { ProactiveEvent, ScheduledJob } from '../src/agent/types.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function makeWorkspaceBrief(overrides: Partial<SubDesignBrief> = {}): SubDesignBrief {
  return {
    id: 'brief_workspace_01',
    threadId: 'thread_workspace_01',
    surface: 'prototype',
    objective: '設計商品詳情頁',
    platform: 'responsive',
    fidelity: 'high-fidelity',
    constraints: [],
    acceptanceCriteria: [],
    directions: [{ id: 'direction_01', title: 'Calm commerce', summary: '清楚且安靜的商品決策流程' }],
    stage: 'brief',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

function makeWorkspaceArtifact(briefId: string, overrides: Partial<SubDesignArtifact> = {}): SubDesignArtifact {
  return {
    id: 'artifact_workspace_01',
    briefId,
    kind: 'html',
    title: 'product-detail.html',
    entry: 'artifacts/product-detail.html',
    renderer: 'html',
    exports: ['html'],
    supportingFiles: [],
    status: 'complete',
    revision: 1,
    createdAt: '2026-07-14T00:01:00.000Z',
    updatedAt: '2026-07-14T00:01:00.000Z',
    ...overrides,
  }
}

function makeWorkspaceCritique(artifactId: string, briefId: string): SubDesignCritique {
  return {
    artifactId,
    briefId,
    revision: 1,
    createdAt: '2026-07-14T00:02:00.000Z',
    briefCoverage: 90,
    brandConformance: 90,
    accessibility: 90,
    implementationReadiness: 90,
    findings: [],
    evidence: [
      { kind: 'screenshot', summary: '視覺截圖', path: 'evidence/screenshot.png' },
      { kind: 'dom', summary: 'DOM snapshot', path: 'evidence/dom.json' },
      { kind: 'lint', summary: 'Lint evidence', path: 'evidence/lint.json' },
    ],
    verdict: 'pass',
  }
}

function makeWorkspaceSession(briefId: string, artifactId: string, status: SubDesignCritiqueSession['status']): SubDesignCritiqueSession {
  return {
    id: 'crit_session_workspace_01',
    briefId,
    artifactId,
    artifactRevision: 1,
    status,
    threshold: 70,
    currentRoundIndex: 0,
    previewStep: 2,
    rounds: [],
    scoreHistory: [],
    events: [],
    startedAt: '2026-07-14T00:02:00.000Z',
  }
}

let passed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  process.stdout.write(`  · ${name} … `)
  try {
    await fn()
    console.log('ok')
    passed++
  } catch (e) {
    console.log('FAIL')
    console.error(e)
    process.exitCode = 1
  }
}

console.log('Production modules (real TS imports)\n')

await test('runContext resolves explicit project pins without mutable global identity', async () => {
  assert.equal(await resolveEffectiveProjectRoot('  D:/proj/A  '), 'D:/proj/A')
})

await test('conversation automation intent stays suggestion-only in the real parser', () => {
  const schedule = '每天 08:00 寄摘要'
  const event = 'When email received with attachment, archive the invoice'
  const scheduleSuggestion = detectAutomationSuggestion(schedule)
  const eventSuggestion = detectAutomationSuggestion(event)

  assert.equal(scheduleSuggestion?.kind, 'schedule')
  assert.equal(scheduleSuggestion?.schedule?.dailyAt, '08:00')
  assert.equal(eventSuggestion?.kind, 'event')
  assert.equal(classifyLoopType(schedule), 'Goal-based')
  assert.equal(classifyLoopType(event), 'Goal-based')
  assert.notEqual(parseUserRequest(schedule).config.loopType, 'Time-based')
  assert.notEqual(parseUserRequest(event).config.loopType, 'Proactive')

})

await test('plan bubble explains trigger source and auto/force classification', () => {
  const automatic = formatPlanBubble(parseUserRequest('請回覆目前狀態').config, {
    mode: 'auto',
    sourceKind: 'composer',
  })
  assert.match(automatic, /執行計畫（自動分類 · Turn-based）/)
  assert.match(automatic, /Trigger source：對話文字/)
  assert.match(automatic, /分類原因：由對話自動分類/)

  const scheduled = formatPlanBubble(
    parseUserRequest('寄送摘要', 'Time-based').config,
    {
      mode: 'force',
      sourceKind: 'schedule',
      sourceLabel: '定時任務：摘要',
      loopType: 'Time-based',
    },
  )
  assert.match(scheduled, /執行計畫（手動指定 · Time-based）/)
  assert.match(scheduled, /Trigger source：ScheduledJob trigger · 定時任務：摘要/)
  assert.match(scheduled, /分類原因：由已驗證 ScheduledJob trigger 明確指定 Time-based/)

  const event = resolvePlanBubbleMetadata({
    mode: 'force',
    sourceKind: 'webhook',
    sourceLabel: 'Webhook 事件：發票',
    loopType: 'Proactive',
  })
  assert.equal(event.triggerSource, 'Webhook event payload · Webhook 事件：發票')
  assert.equal(
    event.classificationReason,
    '由已驗證 Webhook matcher evidence 明確指定 Proactive',
  )
})

await test('taskRunCoordinator normalizes ingress without mutating caller input', () => {
  const input = { objective: '  hello coordinator  ', sourceKind: 'composer' as const }
  const normalized = normalizeTaskRunInput(input)
  assert.equal(normalized.objective, 'hello coordinator')
  assert.notEqual(normalized, input)
  assert.equal(input.objective, '  hello coordinator  ')

  const clean = { objective: 'already clean', sourceKind: 'composer' as const }
  assert.equal(normalizeTaskRunInput(clean), clean)
})

await test('runTask rejects an empty objective before lifecycle admission', async () => {
  let settled = 0
  const result = await runTask({
    objective: '   ',
    onSettled: () => {
      settled += 1
    },
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'empty objective')
  assert.equal(result.threadId, null)
  assert.equal(settled, 0)
})

await test('runTask rejects a re-entrant runId before a second dispatch', async () => {
  const first = runTask({ objective: 'duplicate run smoke', runId: 'prod-duplicate-run' })
  const duplicate = await runTask({ objective: 'duplicate run smoke', runId: 'prod-duplicate-run' })
  assert.equal(duplicate.status, 'skipped')
  assert.equal(duplicate.skipReason, 'duplicate')
  // The renderer graph uses extensionless imports that this direct Node smoke
  // intentionally does not resolve; the assertion above is synchronous at the
  // public seam and does not need the first run's browser-only execution.
  await first.catch(() => undefined)
})

await test('SubDesign workspace derives stage and gate presentation from canonical state', () => {
  const brief = makeWorkspaceBrief()
  const initial = deriveSubDesignWorkspace({ brief })
  assert.equal(initial.currentStage, 'brief')
  assert.equal(initial.nextGate.id, 'direction')
  assert.equal(initial.nextGate.status, 'blocked')
  assert.equal(initial.nextGate.action, 'choose-direction')
  assert.equal(initial.stages.find((stage) => stage.id === 'brief')?.state, 'active')
  assert.equal(initial.stages.find((stage) => stage.id === 'build')?.state, 'locked')

  const buildingBrief = makeWorkspaceBrief({ stage: 'build', selectedDirectionId: 'direction_01' })
  const running = deriveSubDesignWorkspace({ brief: buildingBrief, runStatus: 'running' })
  assert.equal(running.runStatus, 'active')
  assert.equal(running.nextGate.id, 'build')
  assert.equal(running.nextGate.action, 'inspect')
  assert.equal(running.nextGate.title, 'Build 正在執行')

  const artifact = makeWorkspaceArtifact(buildingBrief.id)
  const completed = deriveSubDesignWorkspace({ brief: buildingBrief, artifacts: [artifact], runStatus: 'success' })
  assert.equal(completed.hasCompleteArtifact, true)
  assert.equal(completed.nextGate.id, 'critique')
  assert.equal(completed.nextGate.action, 'review-critique')
  assert.equal(completed.latestArtifact?.id, artifact.id)

  const deliveredBrief = makeWorkspaceBrief({ stage: 'deliver', selectedDirectionId: 'direction_01' })
  const passed = deriveSubDesignWorkspace({
    brief: deliveredBrief,
    artifacts: [artifact],
    selectedArtifact: artifact,
    critique: makeWorkspaceCritique(artifact.id, deliveredBrief.id),
  })
  assert.equal(passed.critiqueStatus, 'passed')
  assert.equal(passed.nextGate.status, 'ready')
  assert.equal(passed.nextGate.action, 'deliver')

  const reviewBrief = makeWorkspaceBrief({ stage: 'critique', selectedDirectionId: 'direction_01' })
  const runningReview = deriveSubDesignWorkspace({
    brief: reviewBrief,
    artifacts: [artifact],
    selectedArtifact: artifact,
    critiqueSession: makeWorkspaceSession(reviewBrief.id, artifact.id, 'running'),
  })
  assert.equal(runningReview.critiqueStatus, 'running')
  assert.equal(runningReview.nextGate.action, 'inspect')

  const needsRevision = deriveSubDesignWorkspace({
    brief: reviewBrief,
    artifacts: [artifact],
    selectedArtifact: artifact,
    critique: { ...makeWorkspaceCritique(artifact.id, reviewBrief.id), verdict: 'needs-revision' },
    critiqueSession: makeWorkspaceSession(reviewBrief.id, artifact.id, 'interrupted'),
  })
  assert.equal(needsRevision.critiqueStatus, 'interrupted')
  assert.equal(needsRevision.nextGate.status, 'ready')
  assert.equal(needsRevision.nextGate.action, 'review-critique')

  const passWithoutArtifact = deriveSubDesignWorkspace({
    brief: deliveredBrief,
    critique: makeWorkspaceCritique('missing_artifact', deliveredBrief.id),
  })
  assert.equal(passWithoutArtifact.nextGate.status, 'blocked')
  assert.equal(passWithoutArtifact.nextGate.action, 'review-critique')

  const staleSuccess = deriveSubDesignWorkspace({ brief: buildingBrief, runStatus: 'success' })
  assert.equal(staleSuccess.hasCompleteArtifact, false)
  assert.equal(staleSuccess.nextGate.status, 'blocked')
  assert.equal(staleSuccess.nextGate.action, 'start-build')
})

await test('Phase 5 runner capabilities stay honest for external CLI', () => {
  assert.equal(capabilitiesForRunner('builtin').continueGoal, true)
  assert.equal(capabilitiesForRunner('codex').continueGoal, false)
  assert.equal(capabilitiesForRunner('claude').validateDoD, false)
  assert.equal(EXTERNAL_CLI_RUNNER_CAPABILITIES.iterate, false)
  assert.equal(BUILTIN_RUNNER_CAPABILITIES.parse, true)
  assert.match(EXTERNAL_CLI_DOD_LABEL, /未執行內建 DoD/)
  assert.doesNotMatch(EXTERNAL_CLI_DOD_LABEL, /CLI returned/i)

  const contract = {
    objective: '補齊報表',
    definitionOfDone: '含價格欄與三工具',
    missing: ['缺價格欄'],
    priorDigest: '先前輸出…',
    projectRoot: '/tmp/proj',
    approvalMode: 'auto',
  }
  assert.equal(isCompleteCliContinueGoalContract(contract), true)
  const prompt = formatCliContinueGoalPrompt(contract)
  assert.match(prompt, /Definition of Done/)
  assert.match(prompt, /缺價格欄/)
  assert.match(prompt, /\/tmp\/proj/)
  assert.match(prompt, /approvalMode|Approval mode/i)
  // Capability remains false until a runner fixture enables it
  assert.equal(capabilitiesForRunner('codex').continueGoal, false)
})

await test('Phase 4 ContextPacket keeps failure lessons and session recall under budget', () => {
  assert.ok(scoreQueryText('寄送每日摘要', '每日摘要失敗教訓 tool:bash') > 0)

  const packet = buildContextPacket({
    objective: '寄送每日摘要報表',
    projectGuidance: 'A'.repeat(20_000),
    sessionRecall: '- [memory] 失敗教訓: 上次 bash 超時',
    failureLessons: '- 勿用 bash 無限迴圈 〔tool:bash strategy:Goal-based〕',
    stepEvidence: 'B'.repeat(8_000),
    recentChat: 'User: 請再試一次',
  })
  assert.ok(packet.diagnostics.totalIncludedChars <= packet.diagnostics.totalBudget)
  assert.ok(
    (packet.includedBySlot.failureLessons || '').includes('tool:bash') ||
      (packet.includedBySlot.sessionRecall || '').includes('失敗'),
    'failure lesson or session recall must survive budget',
  )
  assert.ok(packet.includedBySlot.objective, 'objective slot retained')

  const recall = formatSessionRecallBlock(
    [
      { source: 'memory', title: '失敗教訓', snippet: 'bash timeout', score: 2, tags: ['failure', 'tool:bash'] },
      { source: 'archive', title: '舊成功', snippet: 'ok', score: 9 },
    ],
    { maxHits: 2, maxChars: 400 },
  )
  assert.match(recall, /失敗教訓/)
  // Failure-first: failure line appears before high-score archive success
  assert.ok(recall.indexOf('失敗') < recall.indexOf('舊成功'))

  const temporary = buildContextPacket({
    objective: '臨時',
    temporary: true,
    sessionRecall: 'SHOULD_NOT_APPEAR_RECALL',
    memory: 'SHOULD_NOT_APPEAR_MEMORY',
    failureLessons: 'SHOULD_NOT_APPEAR_FAIL',
  })
  assert.equal(temporary.includedBySlot.sessionRecall, undefined)
  assert.equal(temporary.includedBySlot.memory, undefined)
  assert.equal(temporary.includedBySlot.failureLessons, undefined)
  assert.ok(temporary.diagnostics.temporary)
  assert.ok(temporary.diagnostics.notes.some((n) => /temporary/i.test(n)))
})

await test('claimed ScheduledJob produces a durable validated trigger snapshot', () => {
  const dueAt = new Date('2026-07-14T08:00:00.000Z')
  const job = {
    id: 'job_digest',
    name: '摘要',
    objective: '寄摘要',
    loopType: 'Time-based',
    enabled: true,
    kind: 'interval',
    intervalMinutes: 60,
    lastRunAt: null,
    nextRunAt: '2026-07-14T07:59:00.000Z',
    lastStatus: 'idle',
    createdAt: '2026-07-13T08:00:00.000Z',
  } as ScheduledJob
  assert.equal(jobIsDue(job, dueAt), true)

  const claimed = advanceJobAfterRun(job, dueAt)
  const snapshot = createScheduleTriggerSnapshot(claimed)
  const valid = validateScheduleTriggerSnapshot(snapshot, dueAt)
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(valid.snapshot.jobId, 'job_digest')
    assert.equal(valid.snapshot.triggeredAt, dueAt.toISOString())
  }
  assert.equal(isClaimedScheduleTrigger(claimed, snapshot), true)
  assert.equal(isClaimedScheduleTrigger(job, snapshot), false)
  assert.equal(
    validateScheduleTriggerSnapshot(createScheduleTriggerSnapshot(job), dueAt).ok,
    false,
  )
  assert.equal(
    validateScheduleTriggerSnapshot(
      { ...snapshot, triggeredAt: '2026-07-14T08:10:00.000Z' },
      dueAt,
    ).ok,
    false,
  )
})

await test('ContentItem cannot be scheduled twice for the same platform within 24 hours', () => {
  const existing = {
    id: 'publish_schedule_existing',
    contentItemId: 'content_item_launch',
    platform: 'linkedin',
    scheduledAt: '2026-07-14T10:00:00.000Z',
  }
  const result = createPublishScheduleLedger([existing]).create(
    {
      contentItemId: 'content_item_launch',
      platform: 'linkedin',
      scheduledAt: '2026-07-15T09:59:59.000Z',
    },
    { now: new Date('2026-07-14T09:00:00.000Z'), id: 'publish_schedule_duplicate' },
  )

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'CONTENT_PLATFORM_ALREADY_SCHEDULED')
    assert.equal(result.error.message, '此 ContentItem 已在 24 小時內排程發布至此平台')
  }
})

await test('retriggering a ContentItem schedule cannot duplicate publish after a stale snapshot', () => {
  const staleSchedules: Array<{
    id: string
    contentItemId: string
    platform: string
    scheduledAt: string
  }> = []
  const input = {
    contentItemId: 'content_item_launch',
    platform: 'linkedin',
    scheduledAt: '2026-07-14T10:00:00.000Z',
  }

  const ledger = createPublishScheduleLedger(staleSchedules)
  const first = ledger.create(input, {
    id: 'publish_schedule_first',
  })
  const retriggered = ledger.create(input, {
    id: 'publish_schedule_retriggered',
  })

  assert.equal(first.ok, true)
  assert.equal(retriggered.ok, false)
  if (!retriggered.ok) {
    assert.equal(retriggered.error.code, 'CONTENT_PLATFORM_ALREADY_SCHEDULED')
  }
})

await test('retriggering after schedule state reload cannot duplicate publish', () => {
  let persisted: unknown = []
  const storage = {
    read: () => persisted,
    write: (schedules: unknown[]) => {
      persisted = schedules
    },
  }
  const input = {
    contentItemId: 'content_item_restart',
    platform: 'x',
    scheduledAt: '2026-07-14T10:00:00.000Z',
  }

  const firstLedger = createPersistentPublishScheduleLedger(storage)
  const first = firstLedger.create(input, { id: 'publish_schedule_first' })
  const reloadedLedger = createPersistentPublishScheduleLedger(storage)
  const retriggered = reloadedLedger.create(input, {
    id: 'publish_schedule_retriggered',
  })

  assert.equal(first.ok, true)
  assert.equal(retriggered.ok, false)
  if (!retriggered.ok) {
    assert.equal(retriggered.error.code, 'CONTENT_PLATFORM_ALREADY_SCHEDULED')
  }
})

await test('a stale persistent ledger refreshes before a retrigger', () => {
  let persisted: unknown = []
  const storage = {
    read: () => persisted,
    write: (schedules: unknown[]) => {
      persisted = schedules
    },
  }
  const firstLedger = createPersistentPublishScheduleLedger(storage)
  const staleLedger = createPersistentPublishScheduleLedger(storage)
  const input = {
    contentItemId: 'content_item_concurrent',
    platform: 'x',
    scheduledAt: '2026-07-14T10:00:00.000Z',
  }

  assert.equal(firstLedger.create(input, { id: 'publish_schedule_first' }).ok, true)
  const retriggered = staleLedger.create(input, { id: 'publish_schedule_retriggered' })

  assert.equal(retriggered.ok, false)
  if (!retriggered.ok) {
    assert.equal(retriggered.error.code, 'CONTENT_PLATFORM_ALREADY_SCHEDULED')
  }
})

await test('invalid persisted publish schedules are ignored during hydration', () => {
  const ledger = createPersistentPublishScheduleLedger({
    read: () => [
      { id: 'valid', contentItemId: 'item-valid', platform: 'x', scheduledAt: '2026-07-14T10:00:00.000Z' },
      { id: 'invalid', contentItemId: 'item-invalid', platform: 'x', scheduledAt: 'not-a-date' },
    ],
    write: () => undefined,
  })

  assert.deepEqual(ledger.list().map((schedule) => schedule.id), ['valid'])
})

await test('publish schedule is not accepted when persistence fails', () => {
  const ledger = createPersistentPublishScheduleLedger({
    read: () => [],
    write: () => {
      throw new Error('storage unavailable')
    },
  })

  const result = ledger.create(
    {
      contentItemId: 'content_item_persistence',
      platform: 'x',
      scheduledAt: '2026-07-14T10:00:00.000Z',
    },
    { id: 'publish_schedule_not_saved' },
  )

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'CONTENT_SCHEDULE_PERSISTENCE_FAILED')
  }
  assert.deepEqual(ledger.list(), [])
})

await test('ContentItem schedule creation uses the canonical store owner', () => {
  const store = useContentPublishStore
  store.getState().reload()
  const input = {
    contentItemId: 'content_item_store',
    platform: 'instagram',
    scheduledAt: '2026-07-14T10:00:00.000Z',
  }

  const first = store.getState().createSchedule(input, { id: 'store_first' })
  const retriggered = store.getState().createSchedule(input, { id: 'store_retry' })

  assert.equal(first.ok, true)
  assert.equal(retriggered.ok, false)
  assert.equal(store.getState().schedules.length, 1)
})

await test('ContentItem creation rejects duplicate IDs before scheduling', () => {
  const store = useContentItemStore
  store.getState().reload()
  const input = { id: 'content_item_unique', title: '唯一內容', body: '正文' }
  const first = store.getState().createItem(input)
  const duplicate = store.getState().createItem(input)

  assert.equal(first.ok, true)
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) {
    assert.equal(duplicate.error.code, 'CONTENT_ITEM_ALREADY_EXISTS')
  }
  assert.equal(store.getState().items.length, 1)
})

await test('content publishing provider contract covers OAuth/API requirements', () => {
  assert.deepEqual(
    CONTENT_PUBLISH_PROVIDERS.map((provider) => provider.id),
    ['instagram', 'linkedin', 'x', 'facebook', 'youtube'],
  )
  assert.equal(contentPublishProvider(' LINKEDIN ')?.scopes.includes('w_member_social'), true)
  assert.equal(contentPublishProvider('instagram')?.requiresMedia, true)
  assert.equal(contentPublishProvider('youtube')?.mediaKind, 'video')
  assert.equal(contentPublishProvider('x')?.requiresMedia, false)
  assert.equal(composePublishText('標題', '正文'), '標題\n\n正文')
})

await test('content publishing OAuth boundary keeps raw tokens out of renderer IPC', () => {
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/contentPublishBridge.ts'), 'utf8')
  const oauthBlock = preload.slice(preload.indexOf('contentPublishing:'), preload.indexOf('project:', preload.indexOf('contentPublishing:')))

  assert.doesNotMatch(oauthBlock, /accessToken\??:\s*string|refreshToken\??:\s*string/i)
  assert.match(bridge, /setVaultOAuthSecret\(/)
  assert.match(bridge, /runPluginOAuth\(/)
  assert.match(bridge, /Authorization.*Bearer/)
})

await test('scheduled ContentItem is not reported as published without a platform adapter', async () => {
  const registry = createContentPublishAdapterRegistry()
  const result = await registry.publish(
    {
      id: 'schedule_no_adapter',
      contentItemId: 'content_item_no_adapter',
      platform: 'instagram',
      scheduledAt: '2026-07-14T10:00:00.000Z',
    },
    { title: '內容', body: '正文' },
  )

  assert.deepEqual(registry.platforms(), [])
  assert.equal(result.ok, false)
  assert.equal(result.status, 'not-published')
  if (!result.ok) assert.equal(result.code, 'PLATFORM_ADAPTER_UNAVAILABLE')
})

await test('platform adapter success is the only path that reports published', async () => {
  let receivedPlatform = ''
  const registry = createContentPublishAdapterRegistry([
    {
      platform: 'LINKEDIN',
      publish: async (payload) => {
        receivedPlatform = payload.platform
        return { ok: true, status: 'published', externalId: 'post_123' }
      },
    },
  ])
  const result = await registry.publish(
    {
      id: 'schedule_adapter',
      contentItemId: 'content_item_adapter',
      platform: 'linkedin',
      scheduledAt: '2026-07-14T10:00:00.000Z',
    },
    { title: '內容', body: '正文' },
  )

  assert.deepEqual(registry.platforms(), ['linkedin'])
  assert.equal(receivedPlatform, 'linkedin')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.status, 'published')
})

await test('publish execution persists failed status when no adapter is configured', async () => {
  const store = useContentPublishStore
  store.getState().reload()
  const created = store.getState().createSchedule(
    {
      contentItemId: 'content_item_execution_status',
      platform: 'instagram',
      scheduledAt: '2026-07-14T10:00:00.000Z',
    },
    { id: 'schedule_execution_status' },
  )
  assert.equal(created.ok, true)

  const result = await store.getState().publishSchedule('schedule_execution_status', {
    title: '內容',
    body: '正文',
  })
  const schedule = store.getState().schedules.find((item) => item.id === 'schedule_execution_status')

  assert.equal(result.ok, false)
  assert.equal(result.status, 'not-published')
  assert.equal(schedule?.status, 'failed')
  assert.match(schedule?.lastError || '', /adapter/)
})

await test('adapter exceptions become an explicit not-published result', async () => {
  const registry = createContentPublishAdapterRegistry([
    {
      platform: 'x',
      publish: async () => {
        throw new Error('network unavailable')
      },
    },
  ])
  const result = await registry.publish(
    {
      id: 'schedule_adapter_error',
      contentItemId: 'content_item_adapter_error',
      platform: 'x',
      scheduledAt: '2026-07-14T10:00:00.000Z',
    },
    { title: '內容', body: '正文' },
  )

  assert.equal(result.ok, false)
  assert.equal(result.status, 'not-published')
  if (!result.ok) assert.equal(result.code, 'PLATFORM_PUBLISH_FAILED')
})

await test('event matcher returns strict boolean evidence and rejects predicate misses', () => {
  const event: ProactiveEvent = {
    id: 'evt_invoice',
    name: 'Invoice handler',
    source: 'email.received',
    subjectContains: 'Invoice',
    hasAttachment: true,
    keyword: 'archive',
    objective: 'Archive the invoice',
    enabled: true,
    lastTriggeredAt: null,
    triggerCount: 0,
  }
  const payload = {
    source: 'email.received',
    subject: 'Q3 Invoice',
    hasAttachment: true,
    body: 'Please archive the attached invoice.',
    receivedAt: '2026-07-14T08:00:00.000Z',
  }
  const match = matchProactiveEvent(event, payload)
  assert.ok(match)
  assert.equal(match?.trigger.source, 'event')
  assert.equal(match?.trigger.predicates.source.matched, true)
  assert.equal(match?.trigger.predicates.hasAttachment?.actual, true)
  assert.equal(validateEventTriggerSnapshot(match?.trigger, new Date(payload.receivedAt)).ok, true)
  assert.equal(matchProactiveEvent(event, { ...payload, hasAttachment: false }), null)
})

await test('Next_State consumer records Halt/Await and explicit webhook delivery outcomes', async () => {
  const context = {
    runId: 'run_post_state',
    objective: '完成後通知外部系統',
    status: 'success',
    loopType: 'Goal-based',
    result: 'done',
  }
  assert.equal((await consumeNextState('Halt', context)).status, 'halted')
  assert.equal((await consumeNextState('Await User Input', context)).status, 'awaiting_user')

  const missing = await consumeNextState('Dispatch Webhook', context)
  assert.equal(missing.status, 'failed')
  assert.match(missing.error || '', /未設定有效 webhook target/)

  let deliveredTarget = ''
  const delivered = await consumeNextState(
    'Dispatch Webhook',
    { ...context, webhookTarget: 'https://example.test/hooks/agent' },
    async ({ target, payload }) => {
      deliveredTarget = target
      assert.equal(payload.kind, 'subagents.next_state')
      assert.equal(payload.runId, 'run_post_state')
      return { ok: true, status: 202 }
    },
  )
  assert.equal(delivered.status, 'delivered')
  assert.equal(delivered.responseStatus, 202)
  assert.match(deliveredTarget, /example\.test\/hooks\/agent/)

  const failed = await consumeNextState(
    'Dispatch Webhook',
    { ...context, webhookTarget: 'https://example.test/hooks/agent' },
    async () => ({ ok: false, status: 503, error: 'upstream unavailable' }),
  )
  assert.equal(failed.status, 'failed')
  assert.match(failed.error || '', /upstream unavailable/)
})

await test('toolPackage rejects read+POST', () => {
  const bad = validateToolPackage({
    schemaVersion: 1,
    id: 'demo',
    version: '1.0.0',
    tools: [
      {
        name: 'mutate',
        description: 'bad',
        operationClass: 'read',
        kind: 'http_template',
        template: { url: 'https://example.com/x', method: 'POST' },
      },
    ],
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => /POST|write/i.test(e)))
})

await test('effectiveOperationClass elevates smuggled write method', () => {
  const t: ToolPackageTool = {
    name: 'sneaky',
    description: 'x',
    operationClass: 'read',
    kind: 'http_template',
    template: { url: 'https://example.com', method: 'DELETE' },
  }
  assert.equal(effectiveOperationClass(t), 'write')
  const getOnly: ToolPackageTool = {
    ...t,
    template: { url: 'https://example.com', method: 'GET' },
  }
  assert.equal(effectiveOperationClass(getOnly), 'read')
})

await test('compileToolPackage withholds privileged until review', () => {
  const manifest = validateToolPackage({
    schemaVersion: 1,
    id: 'pkg',
    version: '1.0.0',
    tools: [
      {
        name: 'list',
        description: 'list',
        operationClass: 'read',
        kind: 'http_template',
        template: { url: 'https://example.com/list', method: 'GET' },
      },
      {
        name: 'create',
        description: 'create',
        operationClass: 'write',
        kind: 'http_template',
        template: { url: 'https://example.com/create', method: 'POST' },
      },
    ],
  })
  assert.ok(manifest.ok && manifest.manifest)
  const m = manifest.manifest as ToolPackageManifest
  const unapproved = compileToolPackage(m, 'owner1', null)
  assert.ok(unapproved.needsReview)
  assert.deepEqual(unapproved.withheld, ['create'])
  assert.equal(unapproved.tools.length, 1)
  assert.equal(unapproved.tools[0]?.name, 'list')
  const fp = packageFingerprint(m)
  const approved = compileToolPackage(m, 'owner1', {
    approvedFingerprint: fp,
    approvedAt: new Date().toISOString(),
  })
  assert.equal(approved.needsReview, false)
  assert.equal(approved.withheld.length, 0)
  assert.equal(approved.tools.length, 2)
})

await test('hooks source: deny wins + no allow action + require-approval', () => {
  // hooks.ts uses extensionless relative imports (bundler-style) — cannot
  // strip-type import under plain Node. Assert the production source contract.
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  assert.match(src, /export function evaluateHooks/)
  assert.match(src, /export function sanitizeHookRules/)
  assert.match(src, /case 'deny'/)
  assert.match(src, /forceAsk:\s*true|forceAsk = true/)
  assert.doesNotMatch(src, /action:\s*['"]allow['"]/)
  assert.match(src, /POINT_ACTIONS/)
  // sanitize must drop unknown actions (allow never in POINT_ACTIONS values)
  assert.match(src, /if \(!POINT_ACTIONS\[point\]\.includes\(action\)\) continue/)
})

await test('platformProcess path + shell helpers', () => {
  if (process.platform === 'win32') {
    assert.equal(isPathInside('C:\\proj', 'C:\\proj\\src\\a.ts'), true)
    assert.equal(isPathInside('C:\\proj', 'C:\\other\\a.ts'), false)
  } else {
    assert.equal(isPathInside('/proj', '/proj/src/a.ts'), true)
    assert.equal(isPathInside('/proj', '/other/a.ts'), false)
  }
  const q = quoteShellArg('hello world')
  assert.ok(q.includes('hello'))
  // firstExecutablePath parses `where` / `command -v` output lines
  const look = firstExecutablePath(
    process.platform === 'win32'
      ? 'C:\\Windows\\System32\\node.exe\r\nC:\\tools\\node'
      : '/usr/local/bin/node\n/usr/bin/node',
  )
  assert.ok(look)
  const spec = shellCommandSpec('echo hi')
  assert.ok(spec.file)
  assert.ok(Array.isArray(spec.args))
})

await test('tiny vision image is detected at the Electron CLI boundary', () => {
  const png = Buffer.alloc(24)
  png.write('\x89PNG\r\n\x1a\n', 0, 'binary')
  png.writeUInt32BE(16, 16)
  png.writeUInt32BE(16, 20)
  const url = `data:image/png;base64,${png.toString('base64')}`
  assert.equal(imagePixelCountFromDataUrl(url), 256)
  assert.equal(isVisionImageTooSmall(url), true)
})

await test('tiny SVG and attachment payloads cannot bypass the CLI image gate', () => {
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg width="16" height="16"></svg>')
  assert.equal(imagePixelCountFromDataUrl(svg), 256)
  assert.equal(isVisionImageTooSmall(svg), true)
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(main, /isImagePayload/)
  assert.match(main, /\^data:image/)
})

await test('runActivityStore isolates concurrent streams and bounds terminal digests', () => {
  const activity = useRunActivityStore
  activity.getState().clear()
  activity.getState().begin('smoke-run-a')
  activity.getState().push({ runId: 'smoke-run-a', kind: 'tool', title: 'A started' })
  activity.getState().begin('smoke-run-b')
  activity.getState().push({ runId: 'smoke-run-a', kind: 'tool', title: 'A late update' })
  activity.getState().push({ runId: 'smoke-run-b', kind: 'tool', title: 'B started' })

  const a = activity.getState().getPresentation('smoke-run-a')
  const b = activity.getState().getPresentation('smoke-run-b')
  assert.ok(a && b)
  assert.deepEqual(a.events.map((event) => event.title), ['A started', 'A late update'])
  assert.deepEqual(b.events.map((event) => event.title), ['B started'])

  for (let i = 0; i < 150; i++) {
    activity.getState().push({ runId: 'smoke-run-a', kind: 'log', title: `event-${i}` })
  }
  activity.getState().end('smoke-run-a', 'A 完成')
  const terminal = activity.getState().getPresentation('smoke-run-a')
  assert.ok(terminal?.terminal)
  assert.equal(terminal?.active, false)
  assert.equal(terminal?.statusLine, 'A 完成')
  assert.ok((terminal?.events.length || 0) <= 40)
  const beforeLateEvent = terminal?.events.length
  activity.getState().push({ runId: 'smoke-run-a', kind: 'error', title: 'must be ignored' })
  assert.equal(activity.getState().getPresentation('smoke-run-a')?.events.length, beforeLateEvent)
  activity.getState().clear()
})

await test('permission asks keep FIFO source identity and request-scoped resolution', async () => {
  const asks = usePermissionAskStore
  asks.getState().setSessionAllow(false)
  asks.getState().resetStats()
  const first = asks.getState().requestAsk({
    threadId: 'smoke-thread-a',
    runId: 'smoke-run-a',
    tool: 'workspace_write',
    args: { path: 'a.txt' },
    timeoutMs: 5_000,
  })
  const second = asks.getState().requestAsk({
    threadId: 'smoke-thread-b',
    runId: 'smoke-run-b',
    tool: 'workspace_write',
    args: { path: 'b.txt' },
    timeoutMs: 5_000,
  })
  const head = asks.getState().current
  assert.equal(head?.threadId, 'smoke-thread-a')
  assert.equal(head?.runId, 'smoke-run-a')
  assert.equal(asks.getState().queue[0]?.runId, 'smoke-run-b')
  asks.getState().resolve('stale-request', 'deny')
  assert.equal(asks.getState().current?.runId, 'smoke-run-a')
  asks.getState().resolve(head!.id, 'allow')
  assert.equal(await first, 'allow')
  const next = asks.getState().current
  assert.equal(next?.runId, 'smoke-run-b')
  asks.getState().resolve(next!.id, 'deny')
  assert.equal(await second, 'deny')
  for (let i = 0; i < 120; i++) asks.getState().beginRunAudit(`smoke-audit-${i}`)
  assert.ok(Object.keys(asks.getState().runStatsByRun).length <= 100)
  asks.getState().resetStats()
})

console.log(`\nproduction modules: ${passed} passed`)
if (process.exitCode) process.exit(process.exitCode)
