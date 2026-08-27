import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  buildHandoffAvailability,
  buildHandoffDocument,
  buildComposerRunOverrides,
  buildComposerRunInput,
  attachmentsForComposerScope,
  isConversationComposerBusy,
  replaceComposerScopeAttachments,
  resolveBuiltinRunnerTransition,
  resolveComposerApprovalMode,
} from '../src/agent/composerRunControls.ts'
import { resolveModelRunnerSelection } from '../src/agent/localCliRun.ts'
import {
  applyComposerApprovalHandoff,
  beginComposerApprovalHandoff,
  finishComposerApprovalHandoff,
  resetComposerApprovalHandoffsForTests,
} from '../src/agent/composerApprovalHandoff.ts'
import { piThinkingLevelForDepth } from '../src/agent/thinking.ts'
import {
  clearRunQueue,
  enqueueExternalRun,
  listQueuedRuns,
  resetRunQueueForTests,
} from '../src/agent/runQueue.ts'
import {
  canSubmitDecision,
  nextSelectedOptions,
  submitsChoiceImmediately,
} from '../src/components/decisionPresentation.ts'

function test(name: string, run: () => void) {
  run()
  console.log(`✓ ${name}`)
}

test('decision presentation keeps option and optional-comment submission coherent', () => {
  assert.equal(submitsChoiceImmediately({ multiSelect: false, allowFreeform: false }), true)
  assert.equal(submitsChoiceImmediately({ multiSelect: false, allowFreeform: true }), false)
  assert.equal(submitsChoiceImmediately({ multiSelect: true, allowFreeform: false }), false)
  assert.deepEqual(nextSelectedOptions(['先建立草稿'], '直接發佈', false), ['直接發佈'])
  assert.deepEqual(nextSelectedOptions(['先建立草稿'], '直接發佈', true), ['先建立草稿', '直接發佈'])
  assert.equal(canSubmitDecision({
    isQuestion: true,
    hasOptions: true,
    hasSelection: true,
    allowFreeform: true,
    hasFreeform: false,
  }), true)
  assert.equal(canSubmitDecision({
    isQuestion: true,
    hasOptions: false,
    hasSelection: false,
    allowFreeform: true,
    hasFreeform: false,
  }), false)
})

test('composer selection overrides the Settings default for one submitted run', () => {
  assert.equal(resolveComposerApprovalMode('auto', 'always'), 'always')
  assert.equal(resolveComposerApprovalMode('full', undefined), 'full')
  assert.deepEqual(buildComposerRunOverrides('auto', 'always'), { approvalMode: 'always' })
})

test('composer plus-menu and Settings selections are frozen into one runTask input', () => {
  const attachment = {
    id: 'attachment-1',
    kind: 'text' as const,
    name: 'notes.txt',
    mimeType: 'text/plain',
    textContent: 'integration audit',
  }
  const input = buildComposerRunInput({
    objective: '  inspect integrations  ',
    threadId: 'thread-a',
    runner: 'codex',
    loopType: 'Goal-based',
    attachments: [attachment],
    projectRoot: '/workspace/a',
    settingsApprovalMode: 'auto',
    selectedApprovalMode: 'always',
    agentMode: 'plan',
    model: 'gpt-5.4',
    thinkingDepth: 'max',
    speed: 'careful',
    temporary: true,
  })

  assert.equal(input.objective, 'inspect integrations')
  assert.equal(input.sourceKind, 'composer')
  assert.equal(input.reuseThreadId, 'thread-a')
  assert.equal(input.runner, 'codex')
  assert.equal(input.loopType, 'Goal-based')
  assert.equal(input.attachments?.[0], attachment)
  assert.equal(input.projectRoot, '/workspace/a')
  assert.equal(input.overrides?.approvalMode, 'always')
  assert.equal(input.overrides?.agentMode, 'plan')
  assert.equal(input.overrides?.model, 'gpt-5.4')
  assert.equal(input.overrides?.thinkingDepth, 'max')
  assert.equal(input.overrides?.speed, 'careful')
  assert.equal(input.overrides?.temporary, true)
  assert.ok((input.overrides?.maxIterations || 0) > 0)
  assert.ok((input.overrides?.maxToolRounds || 0) > 0)
})

test('composer attachments remain isolated by conversation thread', () => {
  const attachment = {
    id: 'attachment-a',
    kind: 'text' as const,
    name: 'thread-a.txt',
    mimeType: 'text/plain',
    textContent: 'thread A only',
  }
  const state = replaceComposerScopeAttachments({}, 'thread-a', [attachment])
  assert.deepEqual(attachmentsForComposerScope(state, 'thread-a'), [attachment])
  assert.deepEqual(attachmentsForComposerScope(state, 'thread-b'), [])
})

test('another conversation submission does not put this composer into steer mode', () => {
  assert.equal(isConversationComposerBusy({ 'thread-a': 1 }, 'thread-b', false), false)
  assert.equal(isConversationComposerBusy({ 'thread-a': 1 }, 'thread-a', false), true)
  assert.equal(isConversationComposerBusy({}, 'thread-b', true), true)
})

test('a slash task consumes the composer approval override at task-run admission', () => {
  resetComposerApprovalHandoffsForTests()
  const lease = beginComposerApprovalHandoff('thread-a', 'always')
  const admitted = applyComposerApprovalHandoff({
    objective: 'inspect integrations',
    sourceKind: 'slash',
    reuseThreadId: 'thread-a',
  })
  assert.equal(admitted.overrides?.approvalMode, 'always')
  assert.equal(finishComposerApprovalHandoff(lease), true)
})

test('a non-task slash command does not consume the composer approval override', () => {
  resetComposerApprovalHandoffsForTests()
  const lease = beginComposerApprovalHandoff('thread-a', 'full')
  assert.equal(finishComposerApprovalHandoff(lease), false)
})

test('selecting a builtin model cannot leave an external runner selected', () => {
  assert.deepEqual(
    resolveModelRunnerSelection({
      currentRunner: 'codex',
      selectedModel: 'native-model',
      providers: [{
        id: 'codex',
        enabled: true,
        authorized: true,
        models: [{ id: 'codex-model' }],
      }],
    }),
    { threadModel: 'native-model', runner: 'builtin' },
  )
})

test('Composer depth reaches the Pi Core task profile vocabulary', () => {
  assert.equal(piThinkingLevelForDepth('fast'), 'low')
  assert.equal(piThinkingLevelForDepth('standard'), 'medium')
  assert.equal(piThinkingLevelForDepth('deep'), 'high')
  assert.equal(piThinkingLevelForDepth('max'), 'xhigh')
  assert.equal(piThinkingLevelForDepth('ultra'), 'max')
  assert.equal(piThinkingLevelForDepth(undefined), undefined)
})

test('switching a Codex CLI model to builtin selects the native Pi subscription provider', () => {
  assert.deepEqual(
    resolveBuiltinRunnerTransition({
      currentRunner: 'codex',
      selectedModel: 'gpt-5.6-luna',
    }),
    {
      threadModel: 'gpt-5.6-luna',
      settingsPatch: {
        apiProvider: 'openai-codex',
        model: 'gpt-5.6-luna',
        fallbackModels: [],
        discoveredModels: [],
      },
    },
  )
  assert.equal(
    resolveBuiltinRunnerTransition({ currentRunner: 'claude', selectedModel: 'claude-sonnet-4-5' })
      .settingsPatch?.apiProvider,
    'anthropic',
  )
  assert.deepEqual(
    resolveBuiltinRunnerTransition({ currentRunner: 'gemini', selectedModel: 'gemini-2.5-pro' }),
    { threadModel: '' },
  )
})

test('handoff is unavailable when the current thread has no Artifact Index', () => {
  assert.deepEqual(buildHandoffAvailability(null, 'thread-a'), {
    available: false,
    reason: '此對話尚無 Artifact Index。完成可索引的任務後才能建立 Handoff。',
  })
})

test('an Artifact Index from another thread cannot power this Handoff', () => {
  assert.equal(
    buildHandoffAvailability(
      { threadId: 'thread-b', runId: 'run-b', entries: [{ id: 'x', type: 'diff', status: 'complete', source: 'x', at: 'now' }] },
      'thread-a',
    ).available,
    false,
  )
})

test('handoff only references indexed evidence and preserves run/thread identity', () => {
  const document = buildHandoffDocument({
    threadId: 'thread-a',
    runId: 'run-a',
    index: {
      threadId: 'thread-a',
      runId: 'run-a',
      entries: [
        {
          id: 'diff-1',
          type: 'diff',
          status: 'complete',
          source: 'app/src/App.tsx',
          revision: 2,
          digest: 'sha256:abc',
          at: '2026-07-19T03:00:00.000Z',
        },
      ],
    },
  })

  assert.match(document, /thread-a/)
  assert.match(document, /run-a/)
  assert.match(document, /app\/src\/App\.tsx/)
  assert.match(document, /sha256:abc/)
  assert.doesNotMatch(document, /secret transcript payload/i)
})

test('queued composer runs persist the captured approval mode', () => {
  class MemoryStorage implements Storage {
    private values = new Map<string, string>()
    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) || null }
    key(index: number) { return [...this.values.keys()][index] || null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
  }

  const previous = globalThis.localStorage
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    resetRunQueueForTests()
    enqueueExternalRun({
      runId: 'run-queued',
      objective: 'queued composer task',
      sourceKind: 'composer',
      overrides: { approvalMode: 'always' },
    })
    assert.equal(listQueuedRuns()[0]?.overrides?.approvalMode, 'always')
    assert.equal(
      JSON.parse(storage.getItem('subagents.runQueue.v1') || '{}').items[0].overrides.approvalMode,
      'always',
    )
    clearRunQueue()
  } finally {
    resetRunQueueForTests()
    if (previous) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous })
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
})

execFileSync(process.execPath, ['scripts/protocols-page-component-fixture.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
})
