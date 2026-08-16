import { create } from 'zustand'
import type {
  EventTriggerSnapshot,
  ProactiveEvent,
  ScheduledJob,
} from '../agent/types'
import {
  matchProactiveEvent,
  type EventMatchResult,
  type ProactiveEventPayload,
} from '../agent/eventMatcher'
import {
  advanceJobAfterRun,
  createJob,
  jobIsDue,
  parseScheduleFromText,
} from '../agent/scheduler'
import { recordScheduleStatus } from '../agent/runJournal.ts'

interface ScheduleStore {
  jobs: ScheduledJob[]
  events: ProactiveEvent[]
  loaded: boolean
  lastTickAt: string | null
  runningJobId: string | null

  load: () => Promise<void>
  persistJobs: () => Promise<void>
  persistEvents: () => Promise<void>
  addJob: (input: {
    name: string
    objective: string
    kind: ScheduledJob['kind']
    intervalMinutes?: number
    dailyAt?: string
    runAt?: string
    skillNames?: string[]
    runner?: ScheduledJob['runner']
    projectRoot?: string
    createdFrom?: ScheduledJob['createdFrom']
  }) => Promise<ScheduledJob>
  updateJobSkills: (id: string, skillNames: string[]) => Promise<void>
  addJobFromObjective: (objective: string) => Promise<void>
  toggleJob: (id: string) => Promise<void>
  removeJob: (id: string) => Promise<void>
  markJobResult: (id: string, status: ScheduledJob['lastStatus']) => Promise<void>
  claimDueJobs: () => ScheduledJob[]
  addEvent: (
    input: Omit<ProactiveEvent, 'id' | 'lastTriggeredAt' | 'triggerCount'>,
  ) => Promise<ProactiveEvent>
  removeEvent: (id: string) => Promise<void>
  toggleEvent: (id: string) => Promise<void>
  matchEventEvidence: (payload: ProactiveEventPayload) => EventMatchResult | null
  matchEvent: (payload: ProactiveEventPayload) => ProactiveEvent | null
  recordEventTrigger: (id: string, evidence?: EventTriggerSnapshot) => Promise<void>
  startTicker: (onDue: (job: ScheduledJob) => void) => () => void
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  jobs: [],
  events: [],
  loaded: false,
  lastTickAt: null,
  runningJobId: null,

  load: async () => {
    let jobs: ScheduledJob[] = []
    let events: ProactiveEvent[] = []
    if (window.subagents?.scheduler?.list) {
      jobs = (await window.subagents.scheduler.list()) as ScheduledJob[]
    } else {
      try {
        jobs = JSON.parse(localStorage.getItem('subagents.jobs') || '[]')
      } catch {
        jobs = []
      }
    }
    if (window.subagents?.events?.list) {
      events = (await window.subagents.events.list()) as ProactiveEvent[]
    } else {
      try {
        events = JSON.parse(localStorage.getItem('subagents.events') || '[]')
      } catch {
        events = []
      }
    }
    set({ jobs, events, loaded: true })
  },

  persistJobs: async () => {
    const jobs = get().jobs
    if (window.subagents?.scheduler?.saveAll) {
      await window.subagents.scheduler.saveAll(jobs)
    } else {
      localStorage.setItem('subagents.jobs', JSON.stringify(jobs))
    }
  },

  persistEvents: async () => {
    const events = get().events
    if (window.subagents?.events?.saveAll) {
      await window.subagents.events.saveAll(events)
    } else {
      localStorage.setItem('subagents.events', JSON.stringify(events))
    }
  },

  addJob: async (input) => {
    const job = createJob(input)
    set({ jobs: [job, ...get().jobs] })
    await get().persistJobs()
    // 回傳建立出來的那一筆：呼叫端需要 id 與 nextRunAt，
    // 靠 name+objective 回讀會在同目標多筆時抓錯人。
    return job
  },

  updateJobSkills: async (id, skillNames) => {
    set({
      jobs: get().jobs.map((j) =>
        j.id === id ? { ...j, skillNames: skillNames.filter(Boolean) } : j,
      ),
    })
    await get().persistJobs()
  },

  addJobFromObjective: async (objective) => {
    const parsed = parseScheduleFromText(objective)
    if (!parsed) {
      await get().addJob({
        name: objective.slice(0, 40),
        objective,
        kind: 'daily',
        dailyAt: '08:00',
      })
      return
    }
    await get().addJob({
      name: objective.slice(0, 40),
      objective,
      kind: parsed.kind,
      intervalMinutes: parsed.intervalMinutes,
      dailyAt: parsed.dailyAt,
    })
  },

  toggleJob: async (id) => {
    set({
      jobs: get().jobs.map((j) => (j.id === id ? { ...j, enabled: !j.enabled } : j)),
    })
    await get().persistJobs()
  },

  removeJob: async (id) => {
    set({ jobs: get().jobs.filter((j) => j.id !== id) })
    await get().persistJobs()
  },

  markJobResult: async (id, status) => {
    set({
      jobs: get().jobs.map((j) =>
        j.id === id
          ? {
              ...j,
              lastStatus: status,
              // An interrupted claim has crossed the trigger boundary; keep
              // it disabled until the user or a queued trigger explicitly
              // rebinds it, so restart cannot execute it twice.
              ...(status === 'interrupted'
                ? { enabled: false, ...(j.kind === 'once' ? { nextRunAt: null } : {}) }
                : {}),
              ...(status === 'running' && j.kind !== 'once' ? { enabled: true } : {}),
            }
          : j,
      ),
      runningJobId: status === 'running' ? id : get().runningJobId === id ? null : get().runningJobId,
    })
    recordScheduleStatus(id, status)
    await get().persistJobs()
  },

  claimDueJobs: () => {
    const now = new Date()
    const due = get().jobs.filter((j) => jobIsDue(j, now))
    if (!due.length) return []
    const claimed: ScheduledJob[] = []
    const nextJobs = get().jobs.map((j) => {
      if (!jobIsDue(j, now)) return j
      const advanced = advanceJobAfterRun(j, now)
      claimed.push(advanced)
      return advanced
    })
    set({ jobs: nextJobs, lastTickAt: now.toISOString() })
    for (const job of claimed) recordScheduleStatus(job.id, 'running')
    void get().persistJobs()
    return claimed
  },

  addEvent: async (input) => {
    const event: ProactiveEvent = {
      ...input,
      id: `evt_${Math.random().toString(36).slice(2, 10)}`,
      lastTriggeredAt: null,
      triggerCount: 0,
    }
    set({ events: [event, ...get().events] })
    await get().persistEvents()
    return event
  },

  removeEvent: async (id) => {
    set({ events: get().events.filter((e) => e.id !== id) })
    await get().persistEvents()
  },

  toggleEvent: async (id) => {
    set({
      events: get().events.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    })
    await get().persistEvents()
  },

  matchEventEvidence: (payload) => {
    // Strict boolean matching ONLY (02_Execution_Rules Pattern 4)
    for (const e of get().events) {
      const matched = matchProactiveEvent(e, payload)
      if (matched) return matched
    }
    return null
  },

  matchEvent: (payload) => get().matchEventEvidence(payload)?.event || null,

  recordEventTrigger: async (id, evidence) => {
    set({
      events: get().events.map((e) =>
        e.id === id
          ? {
              ...e,
              lastTriggeredAt: new Date().toISOString(),
              triggerCount: e.triggerCount + 1,
              lastTriggerEvidence: evidence || e.lastTriggerEvidence,
            }
          : e,
      ),
    })
    await get().persistEvents()
  },

  startTicker: (onDue) => {
    const tick = () => {
      const due = get().claimDueJobs()
      for (const job of due) onDue(job)
    }

    const interval = window.setInterval(tick, 10_000)
    let unsub: (() => void) | undefined
    if (window.subagents?.scheduler?.onTick) {
      unsub = window.subagents.scheduler.onTick(() => tick())
    }
    // immediate check
    tick()

    return () => {
      clearInterval(interval)
      unsub?.()
    }
  },
}))
