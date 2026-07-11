/** @deprecated Prefer AutomationPage tab=events. Route redirects to /automation?tab=events. */
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { useScheduleStore } from '../store/scheduleStore'
import { useAgentStore } from '../store/agentStore'

/**
 * Proactive Pattern 4 — strict boolean event matching + simulator.
 */
export function EventsPage() {
  const navigate = useNavigate()
  const {
    events,
    load,
    addEvent,
    removeEvent,
    toggleEvent,
    matchEvent,
    recordEventTrigger,
  } = useScheduleStore()
  const { isRunning } = useAgentStore()

  const [name, setName] = useState('Invoice email handler')
  const [source, setSource] = useState('email.received')
  const [subjectContains, setSubjectContains] = useState('Invoice')
  const [hasAttachment, setHasAttachment] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [objective, setObjective] = useState(
    'When email received WITH attachment AND subject CONTAINS Invoice, extract and file the document.',
  )

  // Simulator form
  const [simSource, setSimSource] = useState('email.received')
  const [simSubject, setSimSubject] = useState('Q3 Invoice #4821')
  const [simAttach, setSimAttach] = useState(true)
  const [simBody, setSimBody] = useState('Please process the attached invoice.')
  const [simResult, setSimResult] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    await addEvent({
      name,
      source,
      subjectContains: subjectContains || undefined,
      hasAttachment: hasAttachment,
      keyword: keyword || undefined,
      objective,
      enabled: true,
    })
  }

  const onSimulate = async () => {
    const matched = matchEvent({
      source: simSource,
      subject: simSubject,
      hasAttachment: simAttach,
      body: simBody,
    })
    if (!matched) {
      setSimResult('NO MATCH — predicates false (strict boolean). No action taken.')
      return
    }
    setSimResult(`MATCH → ${matched.name}. Firing Proactive loop…`)
    await recordEventTrigger(matched.id)
    if (isRunning) {
      setSimResult(`MATCH → ${matched.name}, but an agent is already running.`)
      return
    }
    navigate('/')
    const { runExternalObjective } = await import('../agent/runExternal')
    const r = await runExternalObjective({
      sourceKind: 'event',
      objective: matched.objective,
      title: matched.name,
      loopType: 'Proactive',
      eventPreMatched: true,
      sourceLabel: `事件模擬：${matched.name}`,
    })
    if (r.skipped) {
      setSimResult(`MATCH → ${matched.name}, but ${r.skipReason || r.error || 'skipped'}.`)
    } else {
      setSimResult(`MATCH → ${matched.name}. Run finished: ${r.status}`)
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-10 flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-sora)] text-3xl font-semibold mb-1">
          Proactive Events
        </h1>
        <p className="text-on-surface-variant">
          Pattern 4 event bus — strict boolean predicates only (no fuzzy/semantic match). Enable the
          local webhook under Settings to receive real HTTP POSTs at{' '}
          <code className="text-primary font-[family-name:var(--font-mono)] text-xs">
            POST /webhook
          </code>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="glass-panel rounded-xl p-5 flex flex-col gap-3">
          <h2 className="font-[family-name:var(--font-sora)] font-semibold flex items-center gap-2">
            <Icon name="bolt" className="text-primary" size={20} />
            Register Predicate
          </h2>
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Source (exact)">
            <input
              className={inputCls}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="email.received"
            />
          </Field>
          <Field label="Subject contains (optional, case-insensitive substring)">
            <input
              className={inputCls}
              value={subjectContains}
              onChange={(e) => setSubjectContains(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasAttachment}
              onChange={(e) => setHasAttachment(e.target.checked)}
              className="accent-primary-container"
            />
            Require hasAttachment = true
          </label>
          <Field label="Keyword in subject/body (optional)">
            <input className={inputCls} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </Field>
          <Field label="Objective when matched">
            <textarea
              className={inputCls}
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={() => void onCreate()}
            className="self-end px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider uppercase"
          >
            Add Event Rule
          </button>
        </section>

        <section className="glass-panel rounded-xl p-5 flex flex-col gap-3">
          <h2 className="font-[family-name:var(--font-sora)] font-semibold flex items-center gap-2">
            <Icon name="science" className="text-secondary" size={20} />
            Event Simulator
          </h2>
          <Field label="Incoming source">
            <input
              className={inputCls}
              value={simSource}
              onChange={(e) => setSimSource(e.target.value)}
            />
          </Field>
          <Field label="Subject">
            <input
              className={inputCls}
              value={simSubject}
              onChange={(e) => setSimSubject(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={simAttach}
              onChange={(e) => setSimAttach(e.target.checked)}
              className="accent-primary-container"
            />
            Has attachment
          </label>
          <Field label="Body">
            <textarea
              className={inputCls}
              rows={3}
              value={simBody}
              onChange={(e) => setSimBody(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={() => void onSimulate()}
            className="self-end px-4 py-2 rounded-lg border border-primary text-primary text-xs font-semibold tracking-wider uppercase hover:bg-primary/10"
          >
            Fire Event
          </button>
          {simResult && (
            <pre className="bg-surface border border-white/10 rounded-lg p-3 text-xs font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap">
              {simResult}
            </pre>
          )}
        </section>
      </div>

      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
          Rules ({events.length})
        </div>
        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-on-surface-variant">No proactive rules yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e) => (
              <div key={e.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{e.name}</span>
                    <code className="text-[11px] text-secondary font-[family-name:var(--font-mono)]">
                      {e.source}
                    </code>
                    {e.subjectContains && (
                      <span className="text-[10px] text-outline">
                        subject∋{e.subjectContains}
                      </span>
                    )}
                    {e.hasAttachment && (
                      <span className="text-[10px] text-primary">attachment=true</span>
                    )}
                  </div>
                  <p className="text-sm text-on-surface-variant truncate">{e.objective}</p>
                  <p className="text-[11px] text-outline mt-1">
                    triggers: {e.triggerCount} · last:{' '}
                    {e.lastTriggeredAt ? new Date(e.lastTriggeredAt).toLocaleString() : 'never'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleEvent(e.id)}
                    className="px-3 py-1.5 rounded border border-white/10 text-xs font-semibold tracking-wider uppercase"
                  >
                    {e.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEvent(e.id)}
                    className="px-3 py-1.5 rounded border border-error/30 text-error text-xs font-semibold tracking-wider uppercase"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const inputCls =
  'w-full bg-surface border border-white/10 focus:border-secondary rounded-lg px-3 py-2 text-sm text-on-surface outline-none'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  )
}
