import { useMemo } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { TrajectoryPanel } from './components/TrajectoryPanel'
import { RunTimelineList } from './components/RunTimelineList'
import { RunSummaryCard } from './components/RunSummaryCard'
import { createFixturePageLoader } from './dev-trajectory-fixture'

const fixtureDiff = `--- a/app/src/agent/updateContracts.ts
+++ b/app/src/agent/updateContracts.ts
@@ -52,4 +52,6 @@
+// Schema-v1 clients keep the stable wire identity.
-const product = 'AgentStudio'
+const product = 'SubAgents AI'
 const channel = 'stable'`

export function DevTrajectoryMeasurement() {
  const loader = useMemo(() => createFixturePageLoader(20_000), [])
  if (window.location.search === '?view=diff') {
    const files = [
      { path: 'app/scripts/build-update-manifest.mjs', action: 'edit', added: 3, removed: 1 },
      { path: 'app/src/agent/updateContracts.ts', action: 'edit', added: 15, removed: 5 },
      { path: 'app/scripts/smoke-update-migration.mts', action: 'edit', added: 11, removed: 0 },
      { path: 'app/src/components/RunSummaryCard.tsx', action: 'edit', added: 9, removed: 2 },
    ]
    return (
      <MemoryRouter>
        <main className="min-h-screen bg-canvas p-8 text-ink">
          <div className="mx-auto max-w-5xl space-y-8">
            <section className="rounded-card border border-line bg-surface p-5">
              <RunTimelineList rows={[{ id: 'edit-1', kind: 'tool', tool: 'edit', title: '已編輯 updateContracts.ts', settlement: 'success', detail: '/Users/xieyuanyou/Documents/AgentTeam/app/src/agent/updateContracts.ts', diff: fixtureDiff, added: 2, removed: 1 }]} />
            </section>
            <div className="space-y-2">
              <article className="px-1 text-[13px] leading-relaxed text-ink-2">
                已完成品牌相容性調整，並補上跨版本更新驗證。
              </article>
              <RunSummaryCard summary={{ status: 'success', durationMs: 8_000, operations: [], files, diff: fixtureDiff }} />
            </div>
          </div>
        </main>
      </MemoryRouter>
    )
  }
  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: 24 }}>
      <section data-measurement-kind="windowed">
        <h1>Windowed</h1>
        <div style={{ height: 288 }}><TrajectoryPanel sessionId="fixture-windowed" loadPage={loader} /></div>
      </section>
      <section data-measurement-kind="baseline">
        <h1>Full map baseline</h1>
        <div style={{ height: 288 }}><TrajectoryPanel sessionId="fixture-baseline" loadPage={loader} windowed={false} /></div>
      </section>
    </main>
  )
}
