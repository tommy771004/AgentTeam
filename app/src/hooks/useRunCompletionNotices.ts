import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useRunActivityStore } from '../store/runActivityStore'
import { useThreadStore } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  decideRunCompletionNotice,
  type RunCompletionNotice,
} from '../lib/runCompletionNotice'
import { markRunDelivered } from '../agent/runJournal'

/** Notices kept in the shell before the oldest ones are dropped. */
const MAX_QUEUED_NOTICES = 12

/**
 * Announce every run that crosses from live to terminal, wherever the user is.
 *
 * The trigger is the falling edge of the per-run registry — the same
 * `presentations` record the process feed renders — so no second store tracks
 * which runs have finished, and SubDesign build/critique runs raise a notice
 * through exactly the same path as a composer run, with no special case.
 */
export function useRunCompletionNotices() {
  const [notices, setNotices] = useState<RunCompletionNotice[]>([])
  const announced = useRef(new Set<string>())
  const location = useLocation()
  const chatSurfaceVisible = location.pathname === '/' || location.pathname === ''
  // Read through refs so the subscription below is installed exactly once and
  // still sees the current surface without resubscribing on every navigation.
  const surface = useRef({ chatSurfaceVisible })
  surface.current = { chatSurfaceVisible }

  useEffect(() => {
    const announce = (state: ReturnType<typeof useRunActivityStore.getState>) => {
      for (const presentation of Object.values(state.presentations)) {
        const terminal = presentation.terminal
        if (!terminal || presentation.active) continue
        if (announced.current.has(presentation.runId)) continue
        announced.current.add(presentation.runId)
        // A run terminalized without a coordinator settlement (a replayed
        // digest, a recovery projection) has nothing honest to announce.
        if (!terminal.outcome) continue

        const threads = useThreadStore.getState()
        const settings = useSettingsStore.getState().settings
        const notice = decideRunCompletionNotice(
          {
            runId: presentation.runId,
            threadId: presentation.threadId,
            objective: terminal.outcome.objective,
            status: terminal.outcome.status,
            finishedAt: terminal.finishedAt,
            orchestration: {
              iterations: terminal.outcome.iterations,
              maxIterations: terminal.outcome.maxIterations,
              dodMet: terminal.outcome.dodMet,
              executionKind: terminal.outcome.executionKind,
            },
          },
          {
            activeThreadId: threads.activeId,
            visibleRunId: threads.showRunPanel ? state.runId : null,
            chatSurfaceVisible: surface.current.chatSurfaceVisible,
            osNotifyEnabled: settings.notifyOnComplete !== false,
          },
        )

        // The user has now been told, so the journal must not narrate this
        // completion again as news after the next restart.
        try {
          markRunDelivered(presentation.runId)
        } catch {
          /* journal bookkeeping must never block the notice */
        }

        if (notice.osNotify) {
          void window.subagents?.notify?.(
            `AgentStudio · ${notice.title}`,
            notice.body.slice(0, 160),
          )
          if (settings.soundOnComplete) playCompletionTone(notice.tone)
        }
        if (notice.toast) {
          setNotices((current) => [...current, notice].slice(-MAX_QUEUED_NOTICES))
        }
      }
    }

    // Runs that already settled before the shell mounted are history, not news.
    for (const presentation of Object.values(useRunActivityStore.getState().presentations)) {
      if (presentation.terminal && !presentation.active) announced.current.add(presentation.runId)
    }
    return useRunActivityStore.subscribe(announce)
  }, [])

  const dismiss = useCallback((runId: string) => {
    setNotices((current) => current.filter((notice) => notice.runId !== runId))
  }, [])

  return { notices, dismiss }
}

function playCompletionTone(tone: RunCompletionNotice['tone']) {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = tone === 'danger' ? 220 : tone === 'attention' ? 520 : 880
    gain.gain.value = 0.04
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.12)
    void ctx.close()
  } catch {
    /* audio is a courtesy; never let it surface as an error */
  }
}
