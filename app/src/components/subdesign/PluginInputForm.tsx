import { useState } from 'react'
import { Icon } from '../Icon'
import { McpAppSurface } from './McpAppSurface'
import { SURFACE_STATUS_LABELS } from '../../agent/subdesign/surfaceStatus.ts'
import { useRunActivityStore } from '../../store/runActivityStore'
import { useSurfaceDraftStore } from '../../agent/subdesign/surfaceDraftStore.ts'
import { resolvePluginInputs, type PluginInputValues } from '../../agent/subdesign/pluginInputs.ts'
import type { PluginInput } from '../../agent/openDesign/pluginContract.ts'

/**
 * Collects a v1 plugin's declared inputs before a run.
 *
 * Runs as a sandboxed MCP Apps `form` surface where that is available, and
 * falls back to this native form otherwise. Either way the values go through
 * `resolvePluginInputs`, and Pi Host re-resolves them — a surface that fails
 * cannot skip a required input (issue 07).
 */
export function PluginInputForm({
  briefId,
  threadId,
  runId,
  projectRoot,
  inputs,
  onSubmit,
}: {
  briefId: string
  threadId?: string
  runId?: string
  projectRoot?: string
  inputs: readonly PluginInput[]
  onSubmit: (values: PluginInputValues) => void
}) {
  const surfaceId = `subdesign-plugin-inputs-${briefId}`
  const pushRunActivity = useRunActivityStore((state) => state.push)
  const draftRef = { surfaceId, scope: 'conversation' as const, scopeKey: threadId || briefId }
  const loadDraft = useSurfaceDraftStore((state) => state.loadDraft)
  const saveDraft = useSurfaceDraftStore((state) => state.saveDraft)
  const clearDraft = useSurfaceDraftStore((state) => state.clearDraft)

  // A restored draft is the starting point, so leaving and coming back does
  // not lose what was already typed.
  const seed = () => {
    const draft = loadDraft(draftRef) ?? {}
    const seeded: Record<string, string> = {}
    for (const input of inputs) {
      const value = draft[input.name] ?? input.default
      seeded[input.name] = value === undefined ? '' : String(value)
    }
    return seeded
  }

  // Identity of the form being shown. When the brief or the declared inputs
  // change this is a different form, so the values must be re-seeded — a bare
  // useState initializer would keep the previous plugin's answers.
  const formKey = `${surfaceId}|${inputs.map((input) => input.name).join(',')}`
  const [state, setState] = useState(() => ({ key: formKey, values: seed(), error: '' }))
  if (state.key !== formKey) setState({ key: formKey, values: seed(), error: '' })
  const { values, error } = state

  const update = (name: string, value: string) => {
    const next = { ...values, [name]: value }
    setState({ key: formKey, values: next, error: '' })
    saveDraft(draftRef, next)
  }

  const submit = (raw: Record<string, unknown>) => {
    const resolved = resolvePluginInputs(inputs, raw)
    if (!resolved.ok) {
      const detail = [
        ...resolved.missing.map((name) => `${name} 必填`),
        ...resolved.invalid.map((item) => `${item.name} ${item.reason}`),
      ].join('；')
      setState((current) => ({ ...current, error: detail }))
      return
    }
    clearDraft(draftRef)
    onSubmit(resolved.values)
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-surface-container-low px-4 py-3">
      <header className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-on-surface">Plugin 需要的輸入</p>
        <span className="text-[10px] text-outline">{inputs.length} 項</span>
      </header>
      <McpAppSurface
        surfaceId={surfaceId}
        declaration={{ kind: 'form', scope: 'conversation', allowlist: [] }}
        runId={runId}
        threadId={threadId}
        projectRoot={projectRoot}
        onFormSubmit={submit}
        onStatusChange={(status, detail) => {
          pushRunActivity({
            runId,
            kind: status === 'error' || status === 'invalid' ? 'error' : 'status',
            title: `Plugin 輸入表單：${SURFACE_STATUS_LABELS[status]}`,
            detail,
          })
        }}
        fallback={(
          <div className="mt-2 flex flex-col gap-3">
            {inputs.map((input) => (
              <label key={input.name} className="flex flex-col gap-1">
                <span className="text-[11px] text-outline">
                  {input.label || input.name}
                  {input.required ? <span className="ml-1 text-error">*</span> : null}
                </span>
                {input.type === 'select' && input.options?.length ? (
                  <select
                    value={values[input.name] ?? ''}
                    onChange={(event) => update(input.name, event.target.value)}
                    className="rounded-lg border border-white/12 bg-surface-container px-2 py-1.5 text-[12px] text-on-surface"
                  >
                    <option value="">請選擇…</option>
                    {input.options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : input.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={values[input.name] === 'true'}
                    onChange={(event) => update(input.name, event.target.checked ? 'true' : 'false')}
                    className="h-4 w-4 self-start"
                  />
                ) : (
                  <input
                    type={input.type === 'number' ? 'number' : 'text'}
                    value={values[input.name] ?? ''}
                    placeholder={input.placeholder}
                    onChange={(event) => update(input.name, event.target.value)}
                    className="rounded-lg border border-white/12 bg-surface-container px-2 py-1.5 text-[12px] text-on-surface"
                  />
                )}
              </label>
            ))}
            <button
              type="button"
              onClick={() => submit(values)}
              className="inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-lg bg-primary px-4 text-[11px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              <Icon name="check" size={14} />套用輸入
            </button>
          </div>
        )}
      />
      {error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-error" role="status">{error}</p>
      ) : null}
    </section>
  )
}
