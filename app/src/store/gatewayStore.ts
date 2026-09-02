import { create } from 'zustand'

export type GatewayInboundMsg = {
  channel: 'telegram' | 'webhook' | 'system'
  chatId: string
  text: string
  from?: string
  messageId?: string | number
  receivedAt: string
}

interface GatewayStore {
  inbound: GatewayInboundMsg[]
  telegramRunning: boolean
  botUsername: string | null
  lastError: string | null
  pushInbound: (m: GatewayInboundMsg) => void
  refreshStatus: () => Promise<void>
  setTelegramRunning: (v: boolean) => void
}

const MAX_INBOUND = 40

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  inbound: [],
  telegramRunning: false,
  botUsername: null,
  lastError: null,

  pushInbound: (m) =>
    set({ inbound: [m, ...get().inbound].slice(0, MAX_INBOUND) }),

  refreshStatus: async () => {
    if (!window.subagents?.gateway?.status) return
    try {
      const st = await window.subagents.gateway.status()
      set({
        telegramRunning: st.telegram.running,
        botUsername: st.telegram.botUsername,
        lastError: st.telegram.lastError,
      })
    } catch {
      /* ignore */
    }
  },

  setTelegramRunning: (v) => set({ telegramRunning: v }),
}))
