import { create } from 'zustand'

export type QuestionOption = {
  label: string
  description?: string
  value?: string
}

export type QuestionAskRequest = {
  id: string
  question: string
  options: QuestionOption[]
  multiSelect: boolean
  allowFreeform: boolean
  reason?: string
  createdAt: string
  expiresAt: number
}

type QuestionAnswer = {
  answers: string[]
  freeform?: string
}

type Resolver = (answer: QuestionAnswer | null) => void

interface QuestionAskStore {
  current: QuestionAskRequest | null
  requestQuestion: (input: {
    question: string
    options?: QuestionOption[]
    multiSelect?: boolean
    allowFreeform?: boolean
    reason?: string
    timeoutMs?: number
  }) => Promise<QuestionAnswer | null>
  resolve: (answer: QuestionAnswer | null) => void
}

const resolvers = new Map<string, Resolver>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string) {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

export const useQuestionAskStore = create<QuestionAskStore>((set, get) => ({
  current: null,

  requestQuestion: ({
    question,
    options,
    multiSelect,
    allowFreeform,
    reason,
    timeoutMs,
  }) => {
    const id = `question_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const ms = Math.max(5_000, timeoutMs ?? 90_000)
    const request: QuestionAskRequest = {
      id,
      question: question.trim().slice(0, 2000),
      options: (options || [])
        .map((option) => ({
          label: String(option.label || '').trim().slice(0, 240),
          description: option.description?.slice(0, 500),
          value: option.value?.slice(0, 240),
        }))
        .filter((option) => option.label)
        .slice(0, 12),
      multiSelect: multiSelect === true,
      allowFreeform: allowFreeform !== false,
      reason: reason?.slice(0, 300),
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + ms,
    }

    return new Promise<QuestionAnswer | null>((resolve) => {
      resolvers.set(id, resolve)
      timers.set(
        id,
        setTimeout(() => {
          const resolver = resolvers.get(id)
          if (!resolver) return
          resolvers.delete(id)
          clearTimer(id)
          if (get().current?.id === id) set({ current: null })
          resolver(null)
        }, ms),
      )
      // A run is globally serialized, so one active question is enough. If a
      // future runner needs concurrent questions, this can become a FIFO queue
      // without changing the request/answer contract.
      set({ current: request })
    })
  },

  resolve: (answer) => {
    const current = get().current
    if (!current) return
    const resolver = resolvers.get(current.id)
    resolvers.delete(current.id)
    clearTimer(current.id)
    set({ current: null })
    resolver?.(answer)
  },
}))
