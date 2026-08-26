import { useMemo } from 'react'
import { TrajectoryPanel } from './components/TrajectoryPanel'
import { createFixturePageLoader } from './dev-trajectory-fixture'

export function DevTrajectoryMeasurement() {
  const loader = useMemo(() => createFixturePageLoader(20_000), [])
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
