import { create } from 'zustand'

export type PiHostUiEvent = {
  event: string
  payload: { runId?: string; tool?: string; decision?: string; settlement?: string; reason?: string }
  at: number
}

type PiHostEventState = {
  events: PiHostUiEvent[]
  push: (event: { event: string; payload: unknown }) => void
  clear: () => void
}

function normalizePayload(value: unknown): PiHostUiEvent['payload'] {
  if (!value || typeof value !== 'object') return {}
  const payload = value as Record<string, unknown>
  return {
    ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
    ...(typeof payload.tool === 'string' ? { tool: payload.tool } : {}),
    ...(typeof payload.decision === 'string' ? { decision: payload.decision } : {}),
    ...(typeof payload.settlement === 'string' ? { settlement: payload.settlement } : {}),
    ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
  }
}

export const usePiHostEventStore = create<PiHostEventState>((set) => ({
  events: [],
  push: (event) => set((state) => ({ events: [...state.events, { event: event.event, payload: normalizePayload(event.payload), at: Date.now() }].slice(-100) })),
  clear: () => set({ events: [] }),
}))
