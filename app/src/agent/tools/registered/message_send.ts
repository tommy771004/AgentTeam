/**
 * Self-registering tool module: message_send
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { gateSideEffect, rejectModelSuppliedEvidence } from '../../evidence/sideEffectEvidence.ts'

register({
  name: "message_send",
  toolset: "messaging",
  description: "Send a message via messaging gateway (Telegram etc.)",
  keywords: ["telegram","message","send","reply","gateway","chat"],
  schemaParams: {"type":"object","properties":{"channel":{"type":"string","enum":["telegram"],"description":"Messaging channel"},"chatId":{"type":"string","description":"Chat / channel id"},"text":{"type":"string","description":"Message body"}},"required":["chatId","text"]} as Record<string, unknown>,
  owningCapability: "messaging",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    // ADR-0048: a model may not supply its own execution credential.
    const forged = rejectModelSuppliedEvidence(input)
    if (forged) return { ok: false, output: forged }
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    const channel = (String(input.channel || 'telegram') as 'telegram') || 'telegram'
    const chatId = String(input.chatId || '').trim()
    const text = String(input.text || '').trim()
    if (!chatId || !text) return { ok: false, output: 'chatId 與 text 必填' }
    if (!window.subagents?.gateway?.send) {
      return { ok: false, output: 'Messaging gateway 僅支援 Electron 環境' }
    }
    const settings = useSettingsStore.getState().settings
    const r = await window.subagents.gateway.send({
      channel,
      chatId,
      text,
      token: settings.telegramBotToken || undefined,
      runId,
    })
    if (!r.ok) return { ok: false, output: r.error || 'send failed', data: r }
    // The gateway performed the effect, so only the gateway's snapshot counts.
    // Without it the send is not reportable as delivered, even if r.ok is true.
    const gated = gateSideEffect({ kind: 'message_send', evidence: r.evidence, result: r, runId })
    if (!gated.ok) {
      return { ok: false, output: `訊息送出無法採信：${gated.reason}`, data: r }
    }
    return {
      ok: true,
      output: `已送出至 ${channel}:${chatId}`,
      data: { ...r, evidence: gated.evidence },
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
