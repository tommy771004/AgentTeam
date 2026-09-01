import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextUsagePanel } from '../src/components/ContextUsagePanel.tsx'
import type { ContextUsage } from '../src/agent/contextUsageProjection.ts'

type FixturePayload = {
  running: ContextUsage
  settled: ContextUsage
  legacy: ContextUsage
  unknown: ContextUsage
  externalTokens: number
}

const raw = new URLSearchParams(window.location.search).get('payload')
const payload = raw ? JSON.parse(raw) as FixturePayload : undefined

export function Fixture({ data }: { data: FixturePayload }) {
  const [live, setLive] = useState(data.running)
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-2">
      <section data-testid="live-panel" className="rounded-xl border border-line bg-surface p-4">
        <h1 className="mb-3 text-sm font-semibold text-ink">Live run</h1>
        <ContextUsagePanel usage={live} />
        <button data-testid="settle-step" className="mt-4 rounded-lg border border-line px-3 py-2 text-xs text-ink" type="button" onClick={() => setLive(data.settled)}>
          結算目前步驟
        </button>
      </section>
      <section data-testid="legacy-panel" className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Legacy replay</h2>
        <ContextUsagePanel usage={data.legacy} />
      </section>
      <section data-testid="unknown-panel" className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Unknown pricing/window</h2>
        <ContextUsagePanel usage={data.unknown} />
      </section>
      <section data-testid="external-panel" className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">External CLI</h2>
        <ContextUsagePanel usage={data.unknown} fallbackTokens={data.externalTokens} degraded />
      </section>
    </div>
  )
}

if (!payload) throw new Error('context usage fixture payload is required')
createRoot(document.getElementById('fixture')!).render(<Fixture data={payload} />)
