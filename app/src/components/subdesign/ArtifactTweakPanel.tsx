import { useEffect, useMemo, useState } from 'react'
import type { SubDesignArtifact, SubDesignArtifactTweak } from '../../agent/subdesign/types'
import { usePermissionAskStore } from '../../store/permissionAskStore'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignArtifactStore } from '../../store/subDesignArtifactStore'
import { useSubDesignStore } from '../../store/subDesignStore'
import { Icon } from '../Icon'

type PanelTweak = SubDesignArtifactTweak & { inferred?: boolean }

function inferTweakKind(value: string): PanelTweak['kind'] {
  if (/^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value.trim())) return 'color'
  if (/^-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ms|s)?$/i.test(value.trim())) return 'number'
  if (value.trim() === 'true' || value.trim() === 'false') return 'boolean'
  return 'text'
}

function inferTweakControls(artifact: SubDesignArtifact, content: string): PanelTweak[] {
  const controls: PanelTweak[] = []
  const seen = new Set<string>()
  const pattern = /^(\s*--[a-zA-Z0-9_-]+\s*:\s*)([^;}\n]+)(\s*;?)/gm
  for (const match of content.matchAll(pattern)) {
    const full = match[0]
    const name = match[1].match(/--[a-zA-Z0-9_-]+/)?.[0]
    const value = match[2].trim()
    if (!name || !value || seen.has(name)) continue
    seen.add(name)
    const kind = inferTweakKind(value)
    controls.push({
      id: `inferred-${name.slice(2)}`,
      label: name,
      kind,
      path: artifact.entry,
      find: full,
      replaceTemplate: `${match[1]}{{value}}${match[3]}`,
      value,
      inferred: true,
      min: kind === 'number' ? 0 : undefined,
      max: kind === 'number' ? undefined : undefined,
    })
  }
  return controls.slice(0, 24)
}

function controlValue(tweak: PanelTweak, value: string, setValue: (value: string) => void) {
  if (tweak.kind === 'boolean') {
    return <select value={value} onChange={(event) => setValue(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-black/10 px-2 text-[12px] text-on-surface outline-none focus:border-primary/45"><option value="true">true</option><option value="false">false</option></select>
  }
  if (tweak.kind === 'select') {
    return <select value={value} onChange={(event) => setValue(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-black/10 px-2 text-[12px] text-on-surface outline-none focus:border-primary/45">{(tweak.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  if (tweak.kind === 'number') {
    return <input type="number" value={value} min={tweak.min} max={tweak.max} step={tweak.step || 'any'} onChange={(event) => setValue(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-black/10 px-2 text-[12px] text-on-surface outline-none focus:border-primary/45" />
  }
  return <div className="flex gap-2">{tweak.kind === 'color' && /^#[0-9a-f]{6}$/i.test(value) ? <input aria-label={`${tweak.label} color`} type="color" value={value} onChange={(event) => setValue(event.target.value)} className="h-9 w-10 shrink-0 rounded-lg border border-white/10 bg-transparent p-1" /> : null}<input value={value} onChange={(event) => setValue(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/10 px-2 text-[12px] text-on-surface outline-none focus:border-primary/45" /></div>
}

export function ArtifactTweakPanel({ artifact }: { artifact: SubDesignArtifact | null }) {
  const projectRoot = useProjectStore((state) => state.root)
  const requestAsk = usePermissionAskStore((state) => state.requestAsk)
  const registerArtifact = useSubDesignArtifactStore((state) => state.register)
  const setStage = useSubDesignStore((state) => state.setStage)
  const [controls, setControls] = useState<PanelTweak[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [advancedPath, setAdvancedPath] = useState('')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [expectedMatches, setExpectedMatches] = useState('1')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const paths = useMemo(() => (artifact ? [artifact.entry, ...artifact.supportingFiles] : []), [artifact])

  useEffect(() => {
    let active = true
    setControls([])
    setDrafts({})
    setMessage(null)
    setError(null)
    if (!artifact) return () => { active = false }
    const declared = artifact.tweaks || []
    if (declared.length) {
      setControls(declared)
      setDrafts(Object.fromEntries(declared.map((item) => [item.id, item.value || item.defaultValue || ''])))
      return () => { active = false }
    }
    void window.subagents?.subdesign?.readArtifact?.({ entry: artifact.entry, projectRoot: projectRoot || undefined }).then((result) => {
      if (!active || !result.ok) return
      const inferred = inferTweakControls(artifact, result.content)
      setControls(inferred)
      setDrafts(Object.fromEntries(inferred.map((item) => [item.id, item.value])))
    }).catch(() => undefined)
    return () => { active = false }
  }, [artifact, artifact?.id, artifact?.revision, projectRoot])

  const applyStructured = async (tweak: PanelTweak) => {
    if (!artifact || busyId) return
    const value = drafts[tweak.id] ?? tweak.value
    setBusyId(tweak.id)
    setMessage(null)
    setError(null)
    try {
      const decision = await requestAsk({ tool: 'design_artifact_patch', args: { artifactId: artifact.id, tweakId: tweak.id, value }, reason: `套用「${tweak.label}」即時參數，建立新的 artifact revision。` })
      if (decision !== 'allow') { setMessage('Tweak 已取消或未獲核准。'); return }
      const api = window.subagents?.subdesign
      if (!api) throw new Error('artifact tweak 需要 Electron desktop。')
      const result = tweak.inferred
        ? await api.patchArtifact({ artifact, operations: [{ path: tweak.path, find: tweak.find, replace: tweak.replaceTemplate.replaceAll('{{value}}', value), expectedMatches: 1 }], projectRoot: projectRoot || undefined })
        : await api.applyTweak?.({ artifact, tweakId: tweak.id, value, projectRoot: projectRoot || undefined })
      if (!result?.ok || !result.artifact) throw new Error(result?.error || 'structured tweak 失敗。')
      const stored = registerArtifact(result.artifact, { briefId: artifact.briefId }, projectRoot || undefined)
      if (!stored.ok) throw new Error(`patch revision invalid：${stored.errors.join('；')}`)
      setStage(artifact.briefId, 'critique', projectRoot || undefined)
      setMessage(`已套用「${tweak.label}」：revision ${stored.artifact.revision}。Preview 已刷新，舊 critique 需重新驗證。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }

  const applyAdvanced = async () => {
    if (!artifact || busyId || !advancedPath || !find) return
    setBusyId('advanced')
    setMessage(null)
    setError(null)
    try {
      const decision = await requestAsk({ tool: 'design_artifact_patch', args: { artifactId: artifact.id, path: advancedPath, expectedMatches }, reason: `對 artifact「${artifact.title}」做一次 exact in-place patch。` })
      if (decision !== 'allow') { setMessage('Patch 已取消或未獲核准。'); return }
      const result = await window.subagents?.subdesign?.patchArtifact?.({ artifact, operations: [{ path: advancedPath, find, replace, expectedMatches: Math.max(1, Math.min(12, Number(expectedMatches) || 1)) }], projectRoot: projectRoot || undefined })
      if (!result?.ok || !result.artifact) throw new Error(result?.error || 'artifact patch 失敗。')
      const stored = registerArtifact(result.artifact, { briefId: artifact.briefId }, projectRoot || undefined)
      if (!stored.ok) throw new Error(`patch revision invalid：${stored.errors.join('；')}`)
      setStage(artifact.briefId, 'critique', projectRoot || undefined)
      setMessage(`已完成 exact patch：revision ${stored.artifact.revision}。`)
      setFind(''); setReplace('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusyId(null) }
  }

  return <section className="app-panel">
    <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="tune" size={16} className="text-primary" /> 即時調參 / Live tweaks</div>
      <span className="text-[11px] text-outline">{controls.length ? `${controls.length} controls` : '讀取中…'}</span>
    </div>
    {!artifact ? <div className="px-4 py-7 text-center text-[12px] text-outline">選擇 artifact 後才能調整。</div> : <div className="space-y-3 p-4">
      <p className="text-[11px] leading-relaxed text-outline">宣告過的 control 會做型別、範圍與 exact replacement 驗證；未宣告時會從 CSS custom properties 提供安全的快速控制。</p>
      {controls.length ? <div className="space-y-2">{controls.map((tweak) => <div key={tweak.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor={`tweak-${tweak.id}`} className="truncate text-[11px] font-medium text-on-surface">{tweak.label}</label>{tweak.inferred ? <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-outline">inferred</span> : <span className="rounded-full border border-primary/20 px-1.5 py-0.5 text-[9px] text-primary">{tweak.kind}</span>}</div>
        <div id={`tweak-${tweak.id}`} className="flex gap-2">{controlValue(tweak, drafts[tweak.id] ?? tweak.value, (value) => setDrafts((current) => ({ ...current, [tweak.id]: value })))}<button type="button" disabled={busyId !== null} onClick={() => void applyStructured(tweak)} className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-on-primary disabled:opacity-40">{busyId === tweak.id ? '…' : <><Icon name="bolt" size={13} />套用</>}</button></div>
      </div>)}</div> : <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-[11px] text-outline">目前沒有宣告 control，也找不到 CSS custom property。可用下方進階 exact patch。</div>}
      <details className="rounded-xl border border-white/[0.08] px-3 py-2"><summary className="cursor-pointer text-[11px] font-medium text-outline">進階 exact patch</summary><div className="mt-3 space-y-2">
        <select value={advancedPath} onChange={(event) => setAdvancedPath(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-black/10 px-2 text-[11px] text-on-surface outline-none"><option value="">選擇檔案</option>{paths.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <textarea value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find（exact）" className="min-h-[52px] w-full rounded-lg border border-white/10 bg-black/10 px-2 py-1.5 text-[11px] text-on-surface outline-none" />
        <textarea value={replace} onChange={(event) => setReplace(event.target.value)} placeholder="Replace" className="min-h-[52px] w-full rounded-lg border border-white/10 bg-black/10 px-2 py-1.5 text-[11px] text-on-surface outline-none" />
        <div className="flex items-center gap-2"><input type="number" min={1} max={12} value={expectedMatches} onChange={(event) => setExpectedMatches(event.target.value)} className="h-9 w-24 rounded-lg border border-white/10 bg-black/10 px-2 text-[11px] text-on-surface outline-none" /><button type="button" disabled={busyId !== null || !advancedPath || !find} onClick={() => void applyAdvanced()} className="h-9 flex-1 rounded-lg border border-primary/35 text-[11px] font-semibold text-primary disabled:opacity-40">{busyId === 'advanced' ? '套用中…' : '套用 exact patch'}</button></div>
      </div></details>
      {message ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2.5 text-[11px] leading-relaxed text-primary">{message}</div> : null}
      {error ? <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-[11px] leading-relaxed text-error">{error}</div> : null}
    </div>}
  </section>
}
