/**
 * 工作方式 loop pinning & auto classification (user-reported regression).
 *
 * The composer's 自動/目標/回合 selection must reach the Pi Host turn:
 * - pinned 目標/回合 force the pattern (回合 = single turn, budget 1);
 * - 「自動」 must actually classify per message (Chat-lite → Turn-based,
 *   otherwise Goal-based) instead of silently running the Goal pipeline;
 * - automation sources without a pin keep the Goal-based default;
 * - classification never pins the thread (auto stays per-message).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { classifyLoopType, isChatLiteObjective } from '../src/agent/parser.ts'
import { buildComposerRunInput } from '../src/agent/composerRunControls.ts'
import { buildPiHostRunConfig } from '../src/agent/piHostRun.ts'

// ── Heuristic classifier still owns the auto decision ──
assert.equal(classifyLoopType('你好'), 'Turn-based', 'chat-lite short message → Turn-based')
assert.ok(isChatLiteObjective('幫我總結這段話'))
assert.equal(classifyLoopType('請規劃並實作一個完整的登入系統，包含測試與文件，直到所有驗收條件滿足為止'), 'Goal-based')

// ── Composer pin survives input assembly ──
const pinned = buildComposerRunInput({
  objective: '你好',
  threadId: 't1',
  runner: 'builtin',
  loopType: 'Turn-based',
  settingsApprovalMode: 'auto',
  agentMode: 'build',
  thinkingDepth: 'deep',
  speed: 'standard',
  temporary: false,
})
assert.equal(pinned.loopType, 'Turn-based', 'pinned 回合 must ride the run opts')
const unpinned = buildComposerRunInput({
  ...pinned,
  loopType: null,
})
assert.equal(unpinned.loopType, undefined, 'null pin → undefined → engine classifies')

// ── Run config honors the pin / classified type ──
assert.deepEqual(buildPiHostRunConfig({ forceLoopType: 'Turn-based' }), {
  loopType: 'Turn-based',
  maxIterations: 1,
  definitionOfDone: buildPiHostRunConfig().definitionOfDone,
})
assert.equal(buildPiHostRunConfig({ forceLoopType: 'Goal-based' }).maxIterations >= 5, true)
assert.equal(buildPiHostRunConfig({}).loopType, 'Goal-based', 'automation default stays Goal-based')

// ── Drift guards: the coordinator must classify in auto mode ──
const coordinatorSrc = await readFile(resolve(import.meta.dirname, '../src/agent/taskRunCoordinator.ts'), 'utf8')
assert.match(coordinatorSrc, /classifyLoopType\(objective\)/, 'runTask admission must classify unpinned conversation runs')
assert.match(
  coordinatorSrc,
  /\{ resolvePlanBubbleMetadata, classifyLoopType \}/,
  'classifier must come from the parser module',
)
assert.match(
  coordinatorSrc,
  /forceLoopType: effectiveLoopType/,
  'overrides must carry the effective (pinned or classified) loop type',
)
assert.match(coordinatorSrc, /isInteractiveConversationSource\(opts\)/, 'classification is limited to interactive conversation sources')
// Thread bind keeps the pinned-only value: classification must not pin threads.
assert.match(coordinatorSrc, /loopType: forcedLoopType \|\| null/, 'thread bind must stay pinned-only (auto never pins)')

console.log('smoke-loop-pinning: all assertions passed')
