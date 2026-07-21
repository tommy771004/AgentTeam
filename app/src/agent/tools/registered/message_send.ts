/**
 * Self-registering tool module: message_send
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

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
    })
    return {
      ok: r.ok,
      output: r.ok ? `已送出至 ${channel}:${chatId}` : r.error || 'send failed',
      data: r,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
