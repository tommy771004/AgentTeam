/**
 * P1-D (W7) — controlled lifecycle hooks.
 *
 * Hooks are DECLARATIVE RULES (pure data), never plugin-supplied JS:
 *   beforeRun  → deny / append-context / log / notify
 *   beforeTool → deny / require-approval / log / notify
 *   afterTool  → log / notify
 *   afterRun   → log / notify
 *
 * Trust model: rules can only RESTRICT or OBSERVE — there is no 'allow' action,
 * so a plugin hook can never loosen approval policy. `require-approval` from a
 * hook overrides even approvalMode 'full' (organization policy wins).
 * Every triggered rule is audited into run logs.
 */

import type { LlmSettings } from './types'
import type { RunSourceKind } from './taskRunCoordinator'
import { pluginRegistry } from './hermes/plugins'

export type HookPoint = 'beforeRun' | 'beforeTool' | 'afterTool' | 'afterRun'

export type HookAction = 'deny' | 'require-approval' | 'append-context' | 'log' | 'notify'

export type HookRule = {
  id: string
  point: HookPoint
  /** All present matchers must match (AND). Absent = match everything. */
  match?: {
    /** Tool name; trailing `*` = prefix match (beforeTool/afterTool only) */
    tool?: string
    sourceKind?: RunSourceKind[]
    objectiveIncludes?: string
    /** afterTool: only when the tool failed */
    onlyOnFailure?: boolean
  }
  action: HookAction
  reason?: string
  /** append-context payload (capped) */
  text?: string
  source: 'user' | 'plugin'
  pluginId?: string
  enabled?: boolean
}

/** Actions each point supports; anything else is dropped at sanitize time. */
const POINT_ACTIONS: Record<HookPoint, HookAction[]> = {
  beforeRun: ['deny', 'append-context', 'log', 'notify'],
  beforeTool: ['deny', 'require-approval', 'log', 'notify'],
  afterTool: ['log', 'notify'],
  afterRun: ['log', 'notify'],
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/

export function sanitizeHookRules(
  raw: unknown,
  source: 'user' | 'plugin',
  pluginId?: string,
): HookRule[] {
  if (!Array.isArray(raw)) return []
  const out: HookRule[] = []
  for (const r of raw as Array<Partial<HookRule>>) {
    if (!r || typeof r !== 'object') continue
    if (!r.id || !ID.test(String(r.id))) continue
    const point = r.point as HookPoint
    if (!POINT_ACTIONS[point]) continue
    const action = r.action as HookAction
    if (!POINT_ACTIONS[point].includes(action)) continue
    out.push({
      id: String(r.id),
      point,
      match: r.match && typeof r.match === 'object' ? {
        tool: r.match.tool ? String(r.match.tool).slice(0, 80) : undefined,
        sourceKind: Array.isArray(r.match.sourceKind)
          ? (r.match.sourceKind.map(String) as RunSourceKind[])
          : undefined,
        objectiveIncludes: r.match.objectiveIncludes
          ? String(r.match.objectiveIncludes).slice(0, 120)
          : undefined,
        onlyOnFailure: r.match.onlyOnFailure === true,
      } : undefined,
      action,
      reason: r.reason ? String(r.reason).slice(0, 200) : undefined,
      text: r.text ? String(r.text).slice(0, 2000) : undefined,
      source,
      pluginId: source === 'plugin' ? pluginId : undefined,
      enabled: r.enabled !== false,
    })
  }
  return out
}

export type HookContext = {
  point: HookPoint
  tool?: string
  toolOk?: boolean
  sourceKind?: RunSourceKind
  objective?: string
}

function ruleMatches(rule: HookRule, ctx: HookContext): boolean {
  if (rule.point !== ctx.point) return false
  const m = rule.match
  if (!m) return true
  if (m.tool) {
    const t = ctx.tool || ''
    const ok = m.tool.endsWith('*') ? t.startsWith(m.tool.slice(0, -1)) : t === m.tool
    if (!ok) return false
  }
  if (m.sourceKind?.length && (!ctx.sourceKind || !m.sourceKind.includes(ctx.sourceKind))) {
    return false
  }
  if (
    m.objectiveIncludes &&
    !(ctx.objective || '').toLowerCase().includes(m.objectiveIncludes.toLowerCase())
  ) {
    return false
  }
  if (m.onlyOnFailure && ctx.toolOk !== false) return false
  return true
}

export type HookEvaluation = {
  /** First matching deny rule (deny wins over everything) */
  deny?: { rule: HookRule; reason: string }
  /** Any require-approval matched — overrides approvalMode 'full' */
  forceAsk: boolean
  /** append-context payloads (beforeRun) */
  appendTexts: string[]
  /** Audit lines for run logs（每條觸發規則一行） */
  audits: string[]
  /** notify actions matched */
  notifications: string[]
}

/** Pure evaluation — mirrored in smoke tests. */
export function evaluateHooks(rules: HookRule[], ctx: HookContext): HookEvaluation {
  const out: HookEvaluation = {
    forceAsk: false,
    appendTexts: [],
    audits: [],
    notifications: [],
  }
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (!ruleMatches(rule, ctx)) continue
    const label = `[hook:${rule.id}${rule.pluginId ? `@${rule.pluginId}` : ''}]`
    switch (rule.action) {
      case 'deny':
        if (!out.deny) {
          out.deny = { rule, reason: rule.reason || `被 hook ${rule.id} 拒絕` }
        }
        out.audits.push(`${label} deny：${rule.reason || ctx.tool || ctx.point}`)
        break
      case 'require-approval':
        out.forceAsk = true
        out.audits.push(`${label} require-approval：${ctx.tool || ctx.point}`)
        break
      case 'append-context':
        if (rule.text) out.appendTexts.push(rule.text)
        out.audits.push(`${label} append-context（${rule.text?.length || 0} chars）`)
        break
      case 'notify':
        out.notifications.push(rule.reason || `${ctx.point} 觸發 ${rule.id}`)
        out.audits.push(`${label} notify`)
        break
      case 'log':
        out.audits.push(`${label} ${rule.reason || `${ctx.point} matched`}`)
        break
    }
  }
  return out
}

/** Collect active rules: user settings + enabled plugins (both sanitized). */
export function collectHookRules(settings: Pick<LlmSettings, 'hookRules'>): HookRule[] {
  const rules: HookRule[] = sanitizeHookRules(settings.hookRules || [], 'user')
  try {
    for (const p of pluginRegistry.list()) {
      if (!p.enabled || !p.hooks?.length) continue
      rules.push(...sanitizeHookRules(p.hooks, 'plugin', p.id))
    }
  } catch {
    /* plugins unavailable (tests) */
  }
  return rules
}
