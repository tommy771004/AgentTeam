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
  if (window.location.search === '?view=activity') {
    return (
      <MemoryRouter>
        <main className="min-h-screen w-screen bg-canvas p-8 text-ink">
          <section className="mx-auto w-full max-w-3xl rounded-card bg-surface px-6 py-5" aria-label="執行活動群組預覽">
            <RunTimelineList rows={[
              { id: 'say-1', kind: 'assistant', content: '我先檢查搜尋工具的實際結果，再判斷是搜尋無結果或執行錯誤。' },
              { id: 'cmd-1', kind: 'tool', tool: 'exec_command', title: '執行 rg --version', settlement: 'success', detail: 'rg --version' },
              { id: 'cmd-2', kind: 'tool', tool: 'exec_command', title: '執行 npm --version', settlement: 'success', detail: 'npm --version' },
              { id: 'say-2', kind: 'assistant', content: '兩個基礎指令都完成，接著重現搜尋失敗。' },
              { id: 'grep-1', kind: 'tool', tool: 'grep', title: '搜尋 contentToPlainText|compact|image', settlement: 'failed', detail: 'contentToPlainText|compact|image', resultDetail: 'spawn rg ENOENT' },
              { id: 'grep-2', kind: 'tool', tool: 'grep', title: '搜尋 runTask|objective|history', settlement: 'failed', detail: 'runTask|objective|history', resultDetail: 'Tool argument validation failed: path must be a string' },
              { id: 'say-3', kind: 'assistant', content: '失敗原因現在會和呼叫參數一起保留在 Turn Record，重新開啟任務後仍可追查。' },
            ]} />
          </section>
        </main>
      </MemoryRouter>
    )
  }
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
              <RunSummaryCard summary={{ status: 'success', durationMs: 8_000, operations: [], files, diff: fixtureDiff, reviewSnapshotRef: { snapshotId: 'fixture-review-snapshot', runId: 'fixture-run', status: 'ready', attributionFidelity: 'exact' } }} />
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
