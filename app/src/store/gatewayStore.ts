import { create } from 'zustand'
import type { BackgroundJob } from '../agent/hermes/backgroundJobs'
import {
  listBackgroundJobs,
  subscribeBackgroundJobs,
} from '../agent/hermes/backgroundJobs'

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
  jobs: BackgroundJob[]
  telegramRunning: boolean
  botUsername: string | null
  lastError: string | null
  pushInbound: (m: GatewayInboundMsg) => void
  refreshJobs: () => void
  refreshStatus: () => Promise<void>
  setTelegramRunning: (v: boolean) => void
}

const MAX_INBOUND = 40

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  inbound: [],
  jobs: listBackgroundJobs(),
  telegramRunning: false,
  botUsername: null,
  lastError: null,

  pushInbound: (m) =>
    set({ inbound: [m, ...get().inbound].slice(0, MAX_INBOUND) }),

  refreshJobs: () => set({ jobs: listBackgroundJobs() }),

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

/** Call once from App bootstrap */
export function startBackgroundJobSubscription() {
  return subscribeBackgroundJobs((job) => {
    useGatewayStore.setState((s) => {
      const others = s.jobs.filter((j) => j.id !== job.id)
      return { jobs: [job, ...others].slice(0, 50) }
    })
  })
}
