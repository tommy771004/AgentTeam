import React from 'react'
import { createRoot } from 'react-dom/client'
import { ContextUsagePanel } from '../src/components/ContextUsagePanel.tsx'
import type { ContextUsage } from '../src/agent/contextUsageProjection.ts'

const raw = new URLSearchParams(window.location.search).get('usage')
const usage = raw ? JSON.parse(raw) as ContextUsage[] : []
createRoot(document.getElementById('fixture')!).render(
  <div>
    {usage.map((item, index) => (
      <section data-testid={`usage-${index}`} key={index}>
        <ContextUsagePanel usage={item} />
      </section>
    ))}
  </div>,
)
