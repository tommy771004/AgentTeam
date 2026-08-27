import { useId, useState } from 'react'
import { MemoryImportSession } from '../agent/memoryImport'
import type { MemoryImportMode, MemoryImportPreview } from '../../electron/durableMemoryImport'
import { useLearningStore } from '../store/learningStore'
import { settingsBtnPrimaryCls, settingsInputCls } from './settings/SettingsChrome'

function ImportPreview({ preview }: { preview: MemoryImportPreview }) {
  return <div className="space-y-3">
    <p className="text-sm">新增 {preview.counts.add} · 更新 {preview.counts.update} · 衝突 {preview.counts.conflict} · 略過 {preview.counts.skipped} · 重新命名 {preview.counts.renamed}</p>
    <p className="text-sm">Invalid {preview.counts.invalid} · Quota {preview.counts.quota} · Host revision {preview.revision}</p>
    {preview.issues.length > 0 && <ul className="text-sm space-y-1 break-words">
      {preview.issues.map((issue) => <li key={`${issue.index}-${issue.code}`}>第 {issue.index + 1} 筆：{issue.message}</li>)}
    </ul>}
    <details>
      <summary className="cursor-pointer text-sm">查看 {preview.targets.length} 筆目的地與動作</summary>
      <ul className="mt-2 space-y-2 text-xs break-all">
        {preview.targets.map((target) => <li key={target.index}>{target.scope.kind === 'global' ? '全域' : target.scope.project} / {target.logicalKey}：{target.action}</li>)}
      </ul>
    </details>
  </div>
}

export function MemoryImportPanel() {
  const id = useId()
  const [session] = useState(() => {
    const api = window.subagents?.piHost?.memoryProjection
    const bridge = typeof api?.previewImport === 'function' && typeof api?.applyImport === 'function' ? api : undefined
    return new MemoryImportSession(bridge, async (revision) => {
      await useLearningStore.getState().loadMemoryProjection(undefined, true, revision)
    })
  })
  const [view, setView] = useState(() => session.snapshot())
  const busy = view.phase === 'previewing' || view.phase === 'applying'
  const run = async (task: Promise<void>) => {
    setView(session.snapshot())
    await task
    setView(session.snapshot())
  }
  return <section className="py-4 space-y-4 text-on-surface" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="text-sm font-semibold">匯入長期記憶</h2>
    <p className="text-sm text-on-surface-variant">選擇 canonical memory JSON 或設定包。先預覽，再確認；只匯入記憶，不變更設定。內容為未加密 plaintext。</p>
    <label className="block space-y-2 text-sm">
      <span>記憶備份檔（最多 16 MiB）</span>
      <input type="file" accept="application/json,.json" disabled={busy} className="block w-full text-sm" onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        void run(session.selectFile(file))
      }} />
    </label>
    <label className="block space-y-2 text-sm" htmlFor={`${id}-mode`}>
      <span>相同 scope／key 的衝突處理</span>
      <select id={`${id}-mode`} className={settingsInputCls} value={view.mode} disabled={busy || view.phase === 'empty'} onChange={(event) => void run(session.changeMode(event.target.value as MemoryImportMode))}>
        <option value="skip">Skip：保留現有記憶</option>
        <option value="overwrite">Overwrite：以匯入內容更新</option>
        <option value="rename">Rename：在原 scope 另存新 key</option>
      </select>
    </label>
    {view.preview && <ImportPreview preview={view.preview} />}
    <p role="status" aria-live="polite" className="text-sm break-words">{view.message}</p>
    {view.phase !== 'empty' && <div className="flex flex-wrap items-center gap-4">
      <button type="button" className={settingsBtnPrimaryCls} disabled={!view.canApply || busy} onClick={() => void run(session.apply())}>{view.phase === 'failed' && view.canApply ? '重試同一筆匯入' : '確認套用記憶'}</button>
      <button type="button" className="text-sm text-on-surface-variant hover:text-on-surface" disabled={busy} onClick={() => void run(session.changeMode(view.mode))}>重新預覽</button>
      <button type="button" disabled={view.phase === 'applying'} className="text-sm text-on-surface-variant hover:text-on-surface" onClick={() => { session.cancel(); setView(session.snapshot()) }}>取消</button>
    </div>}
  </section>
}
