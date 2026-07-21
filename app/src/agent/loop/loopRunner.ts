/**
 * Loop Runner — the four Loop Pattern cycles (Turn/Goal/Time/Proactive).
 *
 * Extracted from ../engine.ts (Loop Runner deepening, ticket 03). Boundary:
 * Parse (heuristic + LLM plan refinement), continueGoal restore, project
 * guidance, and Time/Proactive trigger verification all stay on engine —
 * this module starts from an already-parsed LoopRunState and a typed
 * LoopRequest carrying the pattern's verified trigger evidence, if any.
 *
 * @internal — not a product-facing seam. engine.ts is the only caller;
 * smokes may true-import this module directly (see spec.md merge bar).
 */
import type {
  ChatAttachment,
  EventTriggerSnapshot,
  LlmSettings,
  LogLevel,
  RuntimeOverrides,
  ScheduleTriggerSnapshot,
} from '../types.ts'
import { extractKnowledge } from '../knowledge.ts'
import { evaluateDoD } from '../dodEvaluator.ts'
import { replanCorrectiveSteps } from '../replan.ts'
import { resolveRoleModel, synthesizeReport, withRoleModel } from '../llm.ts'
import { learningLoop } from '../hermes/learning.ts'
import {
  buildContinueGoalSnapshot,
  type ContinueGoalSnapshot,
} from '../continueGoal.ts'
import type { LoopRunState } from './state.ts'
import { pickAgentForStep, runStep, type AskDecision, type AskRequest } from './stepRun.ts'

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Typed trigger evidence — an evidence-less Time/Proactive request cannot be constructed. */
export type LoopRequest =
  | { pattern: 'turn' }
  | { pattern: 'goal' }
  | { pattern: 'time'; claim: ScheduleTriggerSnapshot }
  | { pattern: 'proactive'; evidence: EventTriggerSnapshot }

export type LoopDeps = {
  publish: (state: LoopRunState) => void
  ask: (req: AskRequest) => Promise<AskDecision>
  /** Plain "await user ACK" — distinct from the safety-gate ask port. */
  waitForUserAck: () => Promise<void>
  log: (level: LogLevel, message: string) => void
  shouldAbort: () => boolean
  /**
   * Live settings for mid-run configure() — always call the getter so
   * agentEngine.configure replaces take effect on the next read (review bug 2).
   */
  getSettings: () => LlmSettings
  getOverrides: () => RuntimeOverrides
  /**
   * Seeded step evidence from continueGoal restore (prior digest / gaps / user hint).
   * Copied into each pattern's LoopContext.stepOutputs at start (review bug 1).
   */
  initialStepOutputs?: string[]
  projectGuidance: string
  sessionRecallBlock: string
  attachedSkillContext: string
  userAttachments: ChatAttachment[]
  /** continueGoal persistence touches UI thread state — kept as a port, not an import. */
  onGoalIncomplete: (snapshot: ContinueGoalSnapshot) => void
  onGoalCleared: () => void
}

function emptyStepContext(deps: LoopDeps): LoopContext {
  return {
    stepOutputs: [...(deps.initialStepOutputs || [])],
    userAttachments: deps.userAttachments,
  }
}

export type LoopResult = { state: LoopRunState }

function subAgentsEnabledFor(settings: LlmSettings): boolean {
  return settings.subAgentsEnabled === true
}

function executionSettingsFor(settings: LlmSettings, role: string): LlmSettings {
  // Mirrors stepRun.ts's private helper — kept local to avoid a cross-file coupling
  // for one line; both must agree settings pass through unchanged when Sub Agent is off.
  return subAgentsEnabledFor(settings) ? withRoleModel(settings, role) : settings
}

function executionModelFor(settings: LlmSettings, role: string): ReturnType<typeof resolveRoleModel> {
  if (subAgentsEnabledFor(settings)) return resolveRoleModel(settings, role)
  return {
    model: settings.model || '',
    source: settings.model ? 'primary' : 'none',
    roleKey: null,
    usedFallback: true,
  }
}

/** Loop-local mutable context threaded through step execution within one pattern run. */
type LoopContext = {
  stepOutputs: string[]
  userAttachments: ChatAttachment[]
}

function setSubAgent(
  state: LoopRunState,
  name: string,
  status: 'idle' | 'active' | 'done' | 'error',
  lastMessage: string | undefined,
  publish: (s: LoopRunState) => void,
) {
  state.subAgents = state.subAgents.map((a) =>
    a.name === name || a.role === name ? { ...a, status, lastMessage: lastMessage ?? a.lastMessage } : a,
  )
  publish(state)
}

function setSubAgentModel(
  state: LoopRunState,
  name: string,
  status: 'idle' | 'active' | 'done' | 'error',
  modelMeta: { model?: string; modelSource?: string },
  publish: (s: LoopRunState) => void,
) {
  state.subAgents = state.subAgents.map((a) =>
    a.name === name || a.role === name
      ? {
          ...a,
          status,
          model: modelMeta.model ?? a.model,
          modelSource: (modelMeta.modelSource as never) ?? a.modelSource,
        }
      : a,
  )
  publish(state)
}

function updateProgress(state: LoopRunState, stepOutputs: string[], publish: (s: LoopRunState) => void) {
  const done = state.steps.filter((s) => s.status === 'COMPLETED').length
  const total = state.steps.length || 1
  state.progress = Math.round((done / total) * 100)
  state.knowledge = extractKnowledge(state.objective, stepOutputs, state.confidence)
  publish(state)
}

async function executeStep(
  state: LoopRunState,
  index: number,
  iteration: number,
  ctx: LoopContext,
  deps: LoopDeps,
): Promise<{ ok: boolean; output: string; durationMs: number }> {
  const agentName = pickAgentForStep(state, index, state.steps.length, deps.getSettings())
  const result = await runStep(state, index, iteration, agentName, {
    publish: deps.publish,
    ask: deps.ask,
    log: deps.log,
    shouldAbort: deps.shouldAbort,
    getSettings: deps.getSettings,
    getOverrides: deps.getOverrides,
    projectGuidance: deps.projectGuidance,
    sessionRecallBlock: deps.sessionRecallBlock,
    attachedSkillContext: deps.attachedSkillContext,
    userAttachments: ctx.userAttachments,
    stepOutputsSoFar: ctx.stepOutputs,
  })
  ctx.userAttachments = result.userAttachments
  if (result.contributesOutput) {
    ctx.stepOutputs.push(result.output)
    updateProgress(state, ctx.stepOutputs, deps.publish)
    if (!result.ok) deps.publish(state)
  }
  return { ok: result.ok, output: result.output, durationMs: result.durationMs }
}

function deriveReportTitle(objective: string): string {
  if (/market|landscape|orchestr|市場|競品/i.test(objective)) {
    return `市場／競品分析：${objective.slice(0, 40)}`
  }
  if (/security|log|資安|日誌|異常/i.test(objective)) {
    return `資安／日誌分析：${objective.slice(0, 40)}`
  }
  if (/price|competitor|價格|定價/i.test(objective)) {
    return `定價比較：${objective.slice(0, 40)}`
  }
  return `代理報告：${objective.slice(0, 48)}${objective.length > 48 ? '…' : ''}`
}

function synthesizeResultLocal(state: LoopRunState, stepOutputs: string[], settings: LlmSettings): string {
  const obj = state.objective
  const title = deriveReportTitle(obj)
  const steps = state.steps
    .map(
      (s) =>
        `- ✓ **${s.description}**${s.assignedAgent ? ` _(${s.assignedAgent})_` : ''}${
          s.durationMs ? ` — ${(s.durationMs / 1000).toFixed(1)}s` : ''
        }`,
    )
    .join('\n')

  const findings = stepOutputs
    .slice(0, 3)
    .map((o, i) => `### Finding ${i + 1}\n${o.slice(0, 400)}`)
    .join('\n\n')

  const useLlmLabel = settings.enabled && Boolean(settings.apiKey)

  return `# ${title}

This report synthesizes findings from ${subAgentsEnabledFor(settings) ? `${state.subAgents.length} sub-agents` : 'the primary agent'} analyzing the objective.

## Executive Summary

${obj}

The multi-agent loop completed with confidence **${state.confidence.toFixed(2)}** after **${state.currentIteration}** iteration(s).

## Key Trends

- Sub-agent specialization improved step isolation and auditability.
- Validation against Definition of Done prevented premature halt.
- ${useLlmLabel ? 'Cloud LLM synthesis enabled for narrative quality.' : 'Simulation mode produced structured placeholder insights.'}

## Execution Steps
${steps}

## Definition of Done
${state.loopConfig.definitionOfDone}

## Data Insights

${findings || '_No intermediate findings captured._'}

## Payload Example

\`\`\`json
{
  "agent_id": "orchestrator_alpha",
  "task": "goal_execution",
  "session_id": "${state.id}",
  "sub_agents": ${JSON.stringify(state.subAgents.map((a) => a.name))}
}
\`\`\`
`
}

/** Heuristic: does the synthesized result end by asking the user something? */
function resultAwaitsReply(text: string): boolean {
  const trimmed = (text || '').trim()
  if (!trimmed) return false
  const tail = trimmed.slice(-240)
  if (/[?？]\s*$/.test(tail)) return true
  return /(是否|要不要|需要我|想要我|你希望|你想|would you like|do you want|should i|shall i|let me know)/i.test(
    tail,
  )
}

/** Shared learning hook for Goal / Time / Proactive success. learningLoop is a plain module — no UI-store port needed. */
function noteLearningSuccess(state: LoopRunState, deps: LoopDeps, loopType: string) {
  try {
    learningLoop.onGoalSuccess({
      objective: state.objective,
      steps: state.steps.map((s) => ({ description: s.description, result: s.result })),
      toolCalls: (state.toolCalls || [])
        .filter((t) => t.ok)
        .slice(0, 16)
        .map((t) => ({ tool: t.tool, summary: (t.output || '').slice(0, 120) })),
      loopType,
      memoryEnabled: deps.getSettings().memoryEnabled,
      memoryWriteEnabled:
        deps.getSettings().memoryWriteEnabled !== false &&
        deps.getOverrides().temporary !== true &&
        deps.getSettings().temporaryChatDefault !== true,
    })
    deps.log('INFO', '學習迴圈：已產生技能草稿／記憶摘要（見學習中心）')
  } catch {
    /* non-fatal */
  }
}

function noteLearningFailure(state: LoopRunState, deps: LoopDeps, loopType: string, haltReason: string) {
  try {
    learningLoop.onGoalFailure({
      objective: state.objective,
      haltReason,
      loopType,
      failedTools: [...new Set((state.toolCalls || []).filter((t) => !t.ok).map((t) => t.tool))],
      memoryEnabled: deps.getSettings().memoryEnabled,
      memoryWriteEnabled:
        deps.getSettings().memoryWriteEnabled !== false &&
        deps.getOverrides().temporary !== true &&
        deps.getSettings().temporaryChatDefault !== true,
    })
    deps.log('INFO', '學習迴圈：已記錄失敗教訓（見學習中心／記憶）')
  } catch {
    /* learning must never alter task termination */
  }
}

/** Persist unfinished Goal so chat can resume same DoD — snapshot built here, storage is a port. */
function persistContinueGoal(
  state: LoopRunState,
  stepOutputs: string[],
  deps: LoopDeps,
  lastStatus: 'failed' | 'halted',
  missing: string[],
) {
  try {
    const digest = state.result?.trim() || stepOutputs.slice(-2).join('\n---\n').slice(0, 2000) || ''
    const snap = buildContinueGoalSnapshot({
      objective: state.objective,
      definitionOfDone: state.loopConfig.definitionOfDone,
      loopType: state.loopConfig.loopType,
      steps: state.steps,
      missing,
      priorDigest: digest,
      lastStatus,
      runId: state.id,
    })
    deps.onGoalIncomplete(snap)
    deps.log('INFO', 'continueGoal 已保存 — 可「補齊缺口繼續」')
  } catch {
    /* non-fatal */
  }
}

async function finalizeSuccess(state: LoopRunState, ctx: LoopContext, deps: LoopDeps) {
  setSubAgent(state, 'Manager', 'done', undefined, deps.publish)
  setSubAgent(state, 'Analyzer-1', 'done', undefined, deps.publish)
  setSubAgent(state, 'Writer', 'active', undefined, deps.publish)

  let report = synthesizeResultLocal(state, ctx.stepOutputs, deps.getSettings())
  const useLlm = deps.getSettings().enabled && Boolean(deps.getSettings().apiKey)
  if (useLlm) {
    try {
      deps.log('PROCESS', 'Writer synthesizing final report via LLM...')
      const writerResolved = executionModelFor(deps.getSettings(), 'synthesizer')
      const writerSettings = executionSettingsFor(deps.getSettings(), 'synthesizer')
      deps.log(
        'INFO',
        `Writer model=${writerSettings.model} (${subAgentsEnabledFor(deps.getSettings()) ? (writerResolved.usedFallback ? 'fallback→global' : 'roleModels') : 'primary/global'})`,
      )
      setSubAgentModel(
        state,
        'Writer',
        'active',
        { model: writerResolved.model || undefined, modelSource: writerResolved.source },
        deps.publish,
      )
      const r = await synthesizeReport(writerSettings, state.objective, ctx.stepOutputs, state.loopConfig.definitionOfDone)
      report = r.content
      state.tokensUsed += r.tokensUsed
      state.metrics.apiCredits = state.tokensUsed
      deps.log('SUCCESS', `Report synthesized (+${r.tokensUsed} tokens)`)
    } catch (e) {
      deps.log('WARN', `LLM synthesis failed; using local report. ${e instanceof Error ? e.message : e}`)
    }
  }

  setSubAgent(state, 'Writer', 'done', undefined, deps.publish)
  state.result = report
  state.reportTitle = deriveReportTitle(state.objective)
  state.status = 'success'
  state.progress = 100
  state.loopConfig = {
    ...state.loopConfig,
    nextState:
      deps.getOverrides().nextState ||
      (state.loopConfig.nextState === 'Dispatch Webhook'
        ? 'Dispatch Webhook'
        : resultAwaitsReply(report)
          ? 'Await User Input'
          : 'Halt'),
  }
  state.knowledge = extractKnowledge(state.objective, ctx.stepOutputs, state.confidence)
  deps.log('SUCCESS', 'Definition of Done met. Terminating loop.')
  noteLearningSuccess(state, deps, state.loopConfig.loopType)
  deps.onGoalCleared()
  deps.publish(state)
}

// ── Pattern 1: Turn-based ─────────────────────────────────────

async function runTurnBased(state: LoopRunState, deps: LoopDeps): Promise<void> {
  deps.log('INFO', 'Pattern: Turn-based — 1 Input = 1 Action')
  if (!state.steps[0]) return
  const ctx: LoopContext = emptyStepContext(deps)

  const { ok, output } = await executeStep(state, 0, 1, ctx, deps)
  if (!ok || deps.shouldAbort()) return

  state.confidence = Math.max(state.confidence, 0.92)
  state.result = output
  state.reportTitle = 'Turn Result'
  const configuredNextState = deps.getOverrides().nextState || state.loopConfig.nextState
  const chatLiteAck =
    deps.getOverrides().unattended === true ||
    deps.getOverrides().sourceKind === 'composer' ||
    deps.getOverrides().sourceKind === 'slash' ||
    deps.getOverrides().sourceKind === 'retry'
  if (chatLiteAck || configuredNextState === 'Dispatch Webhook') {
    deps.log(
      'INFO',
      configuredNextState === 'Dispatch Webhook'
        ? 'Turn post-state：完成後 Dispatch Webhook'
        : deps.getOverrides().unattended === true
          ? '無人值守 Turn-based：跳過人工 ACK，自動確認'
          : '對話 Turn/Chat-lite：自動確認，不等待 ACK',
    )
  } else {
    deps.log('SUCCESS', 'Action completed. Awaiting user validation (ACK).')
    state.loopConfig = { ...state.loopConfig, nextState: 'Await User Input' }
    await deps.waitForUserAck()
    if (deps.shouldAbort()) return
  }

  state.status = 'success'
  state.progress = 100
  state.loopConfig = {
    ...state.loopConfig,
    nextState: deps.getOverrides().nextState || (configuredNextState === 'Dispatch Webhook' ? 'Dispatch Webhook' : 'Halt'),
  }
  setSubAgent(state, 'Core', 'done', undefined, deps.publish)
  deps.log('SUCCESS', chatLiteAck ? 'Turn complete (auto-ACK).' : 'User ACK received. Turn complete.')
  noteLearningSuccess(state, deps, 'Turn-based')
  deps.publish(state)
}

// ── Pattern 2: Goal-based ─────────────────────────────────────

async function runGoalBased(state: LoopRunState, deps: LoopDeps): Promise<void> {
  const max = state.loopConfig.maxIterations
  deps.log('INFO', 'Pattern: Goal-based — Autonomous iteration until DoD')
  deps.log(
    'INFO',
    subAgentsEnabledFor(deps.getSettings()) ? 'Spawning orchestrator agent...' : 'Sub Agent 關閉：由主代理直接執行。',
  )
  setSubAgent(state, 'Manager', 'active', undefined, deps.publish)
  await delay(300)
  deps.log('INFO', 'Allocating resources for semantic processing.')
  setSubAgent(state, 'Analyzer-1', 'idle', undefined, deps.publish)
  setSubAgent(state, 'Writer', 'idle', undefined, deps.publish)

  const ctx: LoopContext = emptyStepContext(deps)
  const useLlm = deps.getSettings().enabled && Boolean(deps.getSettings().apiKey)
  let lastDodMissing: string[] = []

  for (let iteration = 1; iteration <= max; iteration++) {
    if (deps.shouldAbort()) return
    state.currentIteration = iteration
    state.status = 'running'
    deps.log('PROCESS', `── Iteration ${iteration}/${max} ──`)
    deps.publish(state)

    let brokeEarly = false
    for (let i = 0; i < state.steps.length; i++) {
      if (deps.shouldAbort()) return
      const step = state.steps[i]
      if (step.status === 'COMPLETED' && iteration > 1) continue

      const { ok } = await executeStep(state, i, iteration, ctx, deps)
      if (!ok) return

      // Soft retry path (simulation only, first mid step)
      if (
        !useLlm &&
        iteration === 1 &&
        i === Math.floor(state.steps.length / 2) &&
        Math.random() < 0.12
      ) {
        deps.log('WARN', `Validation low confidence (${state.confidence.toFixed(2)})`)
        state.steps = state.steps.map((s, j) => (j === i ? { ...s, status: 'PENDING' } : s))
        deps.publish(state)
        deps.log('INFO', `Initiating correction loop (Attempt ${iteration}/${max})`)
        brokeEarly = true
        break
      }
    }

    if (brokeEarly) continue

    const allDone = state.steps.every((s) => s.status === 'COMPLETED')
    let dodMet = allDone && state.confidence >= state.minConfidence
    let missing: string[] = []

    if (allDone && useLlm) {
      try {
        const verdict = await evaluateDoD(
          executionSettingsFor(deps.getSettings(), 'analyst'),
          state.objective,
          state.loopConfig.definitionOfDone,
          ctx.stepOutputs,
        )
        dodMet = verdict.met
        missing = verdict.missing
        lastDodMissing = missing
        state.confidence = verdict.confidence
        state.tokensUsed += verdict.tokensUsed
        state.metrics.apiCredits = state.tokensUsed
        deps.log(
          'EVAL',
          `DoD 語意驗收：met=${verdict.met} confidence=${verdict.confidence.toFixed(2)}` +
            (missing.length ? ` · 缺口：${missing.join(' | ').slice(0, 300)}` : ''),
        )
      } catch (e) {
        deps.log('WARN', `DoD 語意驗收失敗，回退步驟/信心啟發式：${e instanceof Error ? e.message : e}`)
      }
    }

    deps.log(
      'EVAL',
      `DoD check: steps=${allDone}, confidence=${state.confidence.toFixed(2)} (≥${state.minConfidence.toFixed(2)}) → ${dodMet}`,
    )

    if (dodMet) {
      await finalizeSuccess(state, ctx, deps)
      return
    }

    if (iteration >= max) {
      state.status = 'failed'
      state.haltReason = 'Max Iterations Reached'
      deps.log('ERROR', `Max iterations (${max}) reached without meeting DoD.`)
      deps.log('WARN', state.loopConfig.fallbackProtocol)
      setSubAgent(state, 'Manager', 'error', undefined, deps.publish)
      noteLearningFailure(state, deps, state.loopConfig.loopType, state.haltReason)
      persistContinueGoal(state, ctx.stepOutputs, deps, 'failed', lastDodMissing)
      deps.publish(state)
      return
    }

    if (allDone && !dodMet) {
      if (missing.length) {
        ctx.stepOutputs.push(`### 上一輪 DoD 缺口（本輪必須補齊）\n${missing.map((item) => `- ${item}`).join('\n')}`)
        state.steps = replanCorrectiveSteps(missing, state.objective, { maxSteps: 3 })
        state.loopConfig = { ...state.loopConfig, executionSequence: state.steps.map((s) => s.description) }
        deps.log('PROCESS', `迭代 replan：${missing.length} 項缺口 → ${state.steps.length} 個修正步驟`)
      } else {
        state.steps = state.steps.map((step) => ({ ...step, status: 'PENDING' as const }))
        deps.log('PROCESS', 'DoD 未達且無 missing 明細：重跑全部步驟')
      }
    } else {
      state.steps = state.steps.map((step) => (step.status === 'COMPLETED' ? step : { ...step, status: 'PENDING' as const }))
    }
    deps.publish(state)
  }
}

/** Shared success/fail scoring for Time / Proactive (no fake 0.99 on total tool failure). */
function finalizePatternRun(
  state: LoopRunState,
  ctx: LoopContext,
  deps: LoopDeps,
  opts: { reportTitle: string; loopType: string; successLog: string },
) {
  const tools = state.toolCalls || []
  const completed = state.steps.filter((s) => s.status === 'COMPLETED').length
  const stepRatio = state.steps.length ? completed / state.steps.length : 0
  const toolOkRatio = tools.length ? tools.filter((t) => t.ok).length / tools.length : 1

  if (tools.length > 0 && tools.every((t) => !t.ok)) {
    state.confidence = Math.min(0.35, toolOkRatio)
    state.status = 'failed'
    state.haltReason = 'All tool calls failed — cannot claim delivery success'
    state.progress = 100
    state.result = synthesizeResultLocal(state, ctx.stepOutputs, deps.getSettings())
    state.reportTitle = opts.reportTitle
    setSubAgent(state, 'Manager', 'error', undefined, deps.publish)
    deps.log('ERROR', state.haltReason)
    noteLearningFailure(state, deps, opts.loopType, state.haltReason)
    deps.publish(state)
    return
  }

  state.confidence = Math.min(0.99, 0.55 + 0.3 * stepRatio + 0.15 * toolOkRatio)
  state.status = 'success'
  state.progress = 100
  state.result = synthesizeResultLocal(state, ctx.stepOutputs, deps.getSettings())
  state.reportTitle = opts.reportTitle
  setSubAgent(state, 'Manager', 'done', undefined, deps.publish)
  deps.log('SUCCESS', `${opts.successLog} (confidence=${state.confidence.toFixed(2)} tools_ok=${(toolOkRatio * 100).toFixed(0)}%)`)
  noteLearningSuccess(state, deps, opts.loopType)
  deps.publish(state)
}

// ── Pattern 3: Time-based ─────────────────────────────────────

async function runTimeBased(state: LoopRunState, deps: LoopDeps): Promise<void> {
  deps.log('INFO', 'Pattern: Time-based — Cron-job style execution')
  const trigger = state.scheduleTrigger
  deps.log('INFO', trigger ? `Trigger window validated：${trigger.jobId} @ ${trigger.triggeredAt}` : `Trigger window validated at ${nowTime()}`)
  setSubAgent(state, 'Manager', 'active', undefined, deps.publish)

  const ctx: LoopContext = emptyStepContext(deps)
  for (let i = 0; i < state.steps.length; i++) {
    if (deps.shouldAbort()) return
    const { ok } = await executeStep(state, i, 1, ctx, deps)
    if (!ok) return
  }

  finalizePatternRun(state, ctx, deps, {
    reportTitle: 'Scheduled Job Report',
    loopType: 'Time-based',
    successLog: 'Time-based execution validated and delivered.',
  })
}

// ── Pattern 4: Proactive ──────────────────────────────────────

async function runProactive(state: LoopRunState, deps: LoopDeps): Promise<void> {
  deps.log('INFO', 'Pattern: Proactive — Event-driven execution')
  const trigger = state.eventTrigger
  deps.log(
    'SUCCESS',
    trigger ? `Event matcher predicates verified：${trigger.eventName} · ${trigger.matchedAt}` : 'Event matcher evidence missing — no action taken.',
  )

  const ctx: LoopContext = emptyStepContext(deps)
  for (let i = 0; i < state.steps.length; i++) {
    if (deps.shouldAbort()) return
    const { ok } = await executeStep(state, i, 1, ctx, deps)
    if (!ok) return
  }

  finalizePatternRun(state, ctx, deps, {
    reportTitle: 'Proactive Event Report',
    loopType: 'Proactive',
    successLog: 'Event action completed successfully.',
  })
}

/**
 * Loop Runner entry — the single fail-closed admission point for typed
 * trigger evidence (CONTEXT.md「Time-based / Proactive trigger」). The
 * substantive verification (scheduler claim lookup, event-matcher evidence)
 * happens on engine.ts during Parse; runLoop only asserts the result was
 * actually supplied, so a caller can never reach a pattern body without it —
 * unrepresentable at the type level, and refused here even if bypassed.
 */
export async function runLoop(req: LoopRequest, state: LoopRunState, deps: LoopDeps): Promise<LoopResult> {
  // Fail-closed even against a type-system bypass (an `any`-cast caller, a
  // future non-TS entry point): the type already makes evidence-less
  // time/proactive requests unrepresentable, but this is the actual runtime
  // admission check, not merely defense-in-depth commentary.
  if (req.pattern === 'time' && !req.claim) {
    state.status = 'failed'
    state.haltReason = 'Time-based request refused: missing claimed trigger evidence'
    deps.log('ERROR', state.haltReason)
    deps.publish(state)
    return { state }
  }
  if (req.pattern === 'proactive' && !req.evidence) {
    state.status = 'failed'
    state.haltReason = 'Proactive request refused: missing event matcher evidence'
    deps.log('ERROR', state.haltReason)
    deps.publish(state)
    return { state }
  }

  switch (req.pattern) {
    case 'turn':
      await runTurnBased(state, deps)
      break
    case 'goal':
      await runGoalBased(state, deps)
      break
    case 'time':
      state.scheduleTrigger = req.claim
      await runTimeBased(state, deps)
      break
    case 'proactive':
      state.eventTrigger = req.evidence
      await runProactive(state, deps)
      break
  }

  if (deps.shouldAbort() && (state.status === 'running' || state.status === 'manual_intervention')) {
    state.status = 'halted'
    state.haltReason = state.haltReason || 'Stopped by user'
    deps.log('WARN', 'Execution aborted by user')
  }

  return { state }
}
