import { useCallback, useEffect, useMemo, useState } from 'react'
import { projectAgentWorkTree, type AgentWorkActivity, type AgentWorkRow } from '../agent/agentWorkTreeProjection.ts'
import type { TurnRecordEntry, TurnRecordPage } from '../agent/turnRecord.ts'
import { useWorkspacePanelSessionStore } from '../store/workspacePanelSessionStore.ts'
import { Icon } from './Icon.tsx'
import { Reveal } from './primitives/Reveal.tsx'

const lifecycleLabel: Record<AgentWorkRow['lifecycle'], string> = {
  admitted: '已建立', queued: '排隊', running: '執行中', 'waiting-approval': '等待核准', blocked: '受阻',
  completed: '完成', failed: '失敗', cancelled: '取消', interrupted: '中止', unknown: '未知',
}

const lifecycleIcon: Record<AgentWorkRow['lifecycle'], string> = {
  admitted: 'radio_button_unchecked', queued: 'schedule', running: 'progress_activity', 'waiting-approval': 'approval', blocked: 'warning',
  completed: 'check_circle', failed: 'error', cancelled: 'cancel', interrupted: 'pause_circle', unknown: 'help',
}

function activityTone(activity: AgentWorkActivity): string {
  if (activity.tone === 'success') return 'text-green'
  if (activity.tone === 'failure') return 'text-red'
  if (activity.tone === 'attention') return 'text-orange'
  if (activity.tone === 'active') return 'text-accent-ink'
  return 'text-ink-3'
}

function mergeEntries(left: readonly TurnRecordEntry[], right: readonly TurnRecordEntry[]): TurnRecordEntry[] {
  const identity = (entry: TurnRecordEntry) => {
    const { seq: _seq, ...durable } = entry
    return `${entry.kind}:${entry.at}:${JSON.stringify(durable)}`
  }
  const unique = new Map([...left, ...right].map((entry) => [identity(entry), entry]))
  return [...unique.values()]
    .sort((a, b) => a.at - b.at || a.seq - b.seq)
    .map((entry, seq) => ({ ...entry, seq }))
}

async function readAgentWorkRecord(sessionId: string): Promise<TurnRecordEntry[]> {
  const read = window.subagents?.piHost?.sessions?.record
  if (!read) return []
  let entries: TurnRecordEntry[] = []
  const tree = await window.subagents?.piHost?.agents?.list?.({ agentId: sessionId }).catch(() => undefined)
  const sessionIds = tree?.agents?.map((agent) => agent.agentId) || [sessionId]
  for (const agentId of sessionIds.slice(0, 64)) {
    let before: number | undefined
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      const result = await read(agentId, before, 128)
      const page = result.page as TurnRecordPage
      entries = mergeEntries(entries, page?.entries || [])
      if (!page?.hasOlder || page.nextBefore === undefined) break
      before = page.nextBefore
    }
  }
  return entries
}

function WorkspaceMode({ row }: { row: AgentWorkRow }) {
  if (!row.workspace) return null
  const label = row.workspace.mode === 'shared-readonly'
    ? '唯讀共享'
    : row.workspace.mode === 'shared-leased-write'
      ? '範圍寫入'
      : '隔離 worktree'
  return <span className="shrink-0 text-[10px] text-ink-3">{label}</span>
}

type AgentActionsApi = NonNullable<NonNullable<Window['subagents']>['piHost']>['agents']
type InvokeAgentAction = (action: () => Promise<unknown>, success: string) => Promise<void>

function ConflictActions({ api, conflictId, parentAgentId, invoke }: { api: AgentActionsApi; conflictId?: string; parentAgentId: string; invoke: InvokeAgentAction }) {
  if (!conflictId || !api.resolveLease) return null
  const resolve = (action: 'serialize' | 'isolate-worktree' | 'cancel', success: string) => void invoke(
    () => api.resolveLease!({ conflictId, requestedBy: parentAgentId, action }), success,
  )
  return <>
    <button type="button" className="agent-process-link" onClick={() => resolve('serialize', '已改為等待目前 writer 完成後自動排入')}>序列執行</button>
    <button type="button" className="agent-process-link" onClick={() => resolve('isolate-worktree', '已切換 verified worktree 並排入')}>隔離執行</button>
    <button type="button" className="agent-process-link text-red" onClick={() => resolve('cancel', '已取消衝突分支')}>取消分支</button>
  </>
}

function IsolatedWorktreeActions({ row, terminal, invoke }: { row: AgentWorkRow; terminal: boolean; invoke: InvokeAgentAction }) {
  const workspace = row.workspace
  const isolated = workspace?.mode === 'isolated-worktree' && workspace.verified && workspace.projectRoot && workspace.worktreePath
  if (!isolated) return null
  const review = async () => {
    if (!row.reviewSnapshotRef) throw new Error('Host 尚未產生此 Agent 的結算快照')
    useWorkspacePanelSessionStore.getState().openTab({ kind: 'review', target: { kind: 'run-snapshot', snapshotId: row.reviewSnapshotRef.snapshotId } }, `審查 · ${row.title}`)
  }
  const apply = async () => {
    const result = await window.subagents!.project!.worktreeApply(workspace.projectRoot!, workspace.worktreePath!)
    if (!result.ok) throw new Error(result.error || '套用隔離變更失敗')
  }
  const discard = async () => {
    const result = await window.subagents!.project!.worktreeRemove(workspace.projectRoot!, workspace.worktreePath!)
    if (!result.ok) throw new Error(result.error || '移除隔離 worktree 失敗')
  }
  return <>
    {row.reviewSnapshotRef ? <button type="button" className="agent-process-link" onClick={() => void invoke(review, '已開啟 Host 結算快照')}>審查隔離結果</button> : terminal ? <span className="text-[10px] text-ink-3">尚無 Host 結算快照</span> : null}
    {terminal ? <button type="button" className="agent-process-link" onClick={() => {
      if (window.confirm(`確定把「${row.title}」的隔離變更套回主工作區？衝突時會停止，不會覆蓋。`)) void invoke(apply, '隔離變更已套回主工作區')
    }}>套用變更</button> : null}
    {terminal ? <button type="button" className="agent-process-link text-red" onClick={() => {
      if (window.confirm(`確定捨棄「${row.title}」的隔離 worktree？分支會保留供追溯。`)) void invoke(discard, '隔離 worktree 已移除；分支仍保留')
    }}>捨棄 worktree</button> : null}
  </>
}

function AgentWorkActions({ row, parentAgentId, onStatus }: { row: AgentWorkRow; parentAgentId?: string; onStatus: (value: string) => void }) {
  const [followUp, setFollowUp] = useState('')
  const api = window.subagents?.piHost?.agents
  if (!parentAgentId || !api) return null
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(row.lifecycle)
  const completionMessage = [...row.activities].reverse().find((activity) => activity.messageId && activity.label === '回傳結果')
  const conflict = [...row.activities].reverse().find((activity) => activity.conflictId)
  const invoke = async (action: () => Promise<unknown>, success: string) => {
    try { await action(); onStatus(success) } catch (error) { onStatus(error instanceof Error ? error.message : '操作失敗') }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
      {!terminal ? <button type="button" className="agent-process-link" onClick={() => void invoke(() => api.interrupt({ requestedBy: parentAgentId, agentId: row.agentId, reason: 'user-request' }), '已要求安全中止')}>中止</button> : null}
      {row.lifecycle === 'blocked' ? <ConflictActions api={api} conflictId={conflict?.conflictId} parentAgentId={parentAgentId} invoke={invoke} /> : null}
      {completionMessage?.messageId ? <button type="button" className="agent-process-link" onClick={() => void invoke(() => api.ack({ agentId: parentAgentId, messageId: completionMessage.messageId }), '已確認結果')}>確認結果</button> : null}
      {terminal ? <button type="button" className="agent-process-link" onClick={() => void invoke(() => api.close({ requestedBy: parentAgentId, agentId: row.agentId }), '已關閉 Agent')}>關閉</button> : null}
      <IsolatedWorktreeActions row={row} terminal={terminal} invoke={invoke} />
      <label className="flex min-w-52 flex-1 items-center gap-2">
        <span className="sr-only">派送後續任務給 {row.title}</span>
        <input value={followUp} onChange={(event) => setFollowUp(event.target.value)} className="h-7 min-w-0 flex-1 border-b border-line bg-transparent px-1 text-[11px] text-ink outline-none focus:border-accent" placeholder="新增後續任務" />
        <button type="button" disabled={!followUp.trim()} className="agent-process-link disabled:opacity-40" title={row.executionKind === 'external-cli-process' ? '外部 CLI 會建立新的 execution，不會復用 provider session' : '沿用此子代理 session'} onClick={() => void invoke(async () => {
          await api.followUp({ senderAgentId: parentAgentId, receiverAgentId: row.agentId, content: followUp.trim() })
          setFollowUp('')
        }, '後續任務已排入')}>派送</button>
      </label>
    </div>
  )
}

function AgentWorkRowView({ row, parentAgentId }: { row: AgentWorkRow; parentAgentId?: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const attention = ['failed', 'blocked', 'waiting-approval'].includes(row.lifecycle) || row.activities.some((item) => item.tone === 'attention' || item.tone === 'failure')
  return (
    <li className="border-t border-line first:border-t-0" data-agent-work-id={row.agentId}>
      <button type="button" aria-expanded={open} className="flex min-h-10 w-full min-w-0 items-center gap-2 py-2 text-left" onClick={() => setOpen((value) => !value)}>
        <Icon name={lifecycleIcon[row.lifecycle]} size={15} className={`shrink-0 ${row.lifecycle === 'running' ? 'animate-spin text-accent-ink' : attention ? 'text-orange' : 'text-ink-3'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink">{row.title}</span>
          <span className="block truncate text-[10.5px] text-ink-3">{row.executionKind === 'external-cli-process' ? '子程序' : '子代理'} · {row.role} · {lifecycleLabel[row.lifecycle]}</span>
        </span>
        <WorkspaceMode row={row} />
        {attention ? <span className="sr-only">需要注意</span> : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={15} className="shrink-0 text-ink-3" />
      </button>
      <Reveal open={open}>
        <div className="pb-2 pl-6 text-[11px]">
          {row.activities.length ? <ol className="space-y-1" aria-label={`${row.title} 活動`}>
            {row.activities.map((item) => <li key={item.id} className="flex min-w-0 gap-2">
              <span className={`shrink-0 ${activityTone(item)}`}>{item.label}</span>
              {item.detail ? <span className="min-w-0 flex-1 break-words text-ink-3">{item.detail}</span> : null}
            </li>)}
          </ol> : <p className="text-ink-3">尚無詳細活動</p>}
          <AgentWorkActions row={row} parentAgentId={parentAgentId} onStatus={setStatus} />
          {status ? <p className="mt-1 text-[10px] text-ink-3" role="status">{status}</p> : null}
        </div>
      </Reveal>
    </li>
  )
}

export function AgentWorkTree({ entries, originTurn, sessionId, live = false }: {
  entries: readonly TurnRecordEntry[]
  originTurn: number
  sessionId?: string
  live?: boolean
}) {
  const [open, setOpen] = useState(live)
  const [replayed, setReplayed] = useState<TurnRecordEntry[]>([])
  const refresh = useCallback(async () => {
    if (!sessionId) return
    try { setReplayed(await readAgentWorkRecord(sessionId)) } catch { /* initial immutable entries remain available */ }
  }, [sessionId])
  useEffect(() => { if (sessionId) void refresh() }, [refresh, sessionId])
  useEffect(() => {
    const cleanup = window.subagents?.piHost?.onEvent?.((event) => {
      if (!open || !sessionId || !event.payload || typeof event.payload !== 'object') return
      if (event.event === 'host/agent-collaboration' || event.event === 'host/agent-lifecycle') void refresh()
    })
    return () => { cleanup?.() }
  }, [open, refresh, sessionId])
  const rows = useMemo(() => projectAgentWorkTree(mergeEntries(entries, replayed), originTurn), [entries, replayed, originTurn])
  if (!rows.length) return null
  const attention = rows.filter((row) => ['failed', 'blocked', 'waiting-approval'].includes(row.lifecycle)).length
  return (
    <section className="agent-work-tree border-y border-line" aria-label="子程序／子代理" data-origin-turn={originTurn}>
      <button type="button" aria-expanded={open} className="flex min-h-10 w-full items-center gap-2 py-2 text-left" onClick={() => setOpen((value) => !value)}>
        <Icon name="account_tree" size={16} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 text-[12px] font-semibold text-ink">子程序／子代理</span>
        <span className={`text-[10.5px] ${attention ? 'text-orange' : 'text-ink-3'}`}>{rows.length} 個執行{attention ? ` · ${attention} 需注意` : ''}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={15} className="shrink-0 text-ink-3" />
      </button>
      <Reveal open={open}><ul>{rows.map((row) => <AgentWorkRowView key={row.agentId} row={row} parentAgentId={sessionId} />)}</ul></Reveal>
    </section>
  )
}
