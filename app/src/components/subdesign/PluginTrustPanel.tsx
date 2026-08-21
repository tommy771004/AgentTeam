import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../Icon'
import type { SubDesignBrief } from '../../agent/subdesign/types'
import { inspectSubDesignPluginTrust, type PluginTrustState } from '../../agent/subdesign/pluginExecutionPreparation'
import {
  adoptPluginSnapshot,
  deniedCapabilities,
  refreshPluginSnapshot,
  requestCapabilityGrants,
  revokePluginGrants,
} from '../../agent/subdesign/pluginTrust'
import { DENY_BY_DEFAULT, type PluginResolvedSnapshot } from '../../agent/subdesign/pluginSnapshot'

/**
 * The user-facing side of plugin trust (issue 02): what this project adopted,
 * which capabilities are granted, and the explicit adopt / refresh / grant /
 * revoke actions. Without this the deny-by-default gate has no way to open.
 */
export function PluginTrustPanel({
  brief,
  projectRoot,
}: {
  brief: SubDesignBrief
  projectRoot?: string
}) {
  const [trust, setTrust] = useState<PluginTrustState | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    const result = await inspectSubDesignPluginTrust(brief, projectRoot)
    if ('reason' in result) {
      setUnavailable(result.reason)
      setTrust(null)
      return
    }
    setUnavailable(null)
    setTrust(result.trust)
  }, [brief, projectRoot])

  useEffect(() => {
    void reload()
  }, [reload])

  // Every action below writes to the project snapshot, so a bound project is
  // a precondition, not something to assert away at the call site.
  if (!projectRoot || unavailable || !trust) {
    const reason = !projectRoot ? '尚未綁定專案。' : unavailable
    return reason ? (
      <p className="text-[11px] leading-relaxed text-outline" role="status">
        Plugin 信任狀態：{reason}
      </p>
    ) : null
  }

  const snapshot = snapshotOf(trust)
  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
      await reload()
      setMessage(label)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-surface-container-low px-4 py-3">
      <header className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-on-surface">Plugin 信任與權限</p>
        <span className="text-[10px] text-outline">{stateLabel(trust)}</span>
      </header>

      {snapshot ? (
        <dl className="mt-2 grid gap-1 text-[11px] text-outline">
          <div className="flex justify-between gap-3">
            <dt>Snapshot</dt>
            <dd className="truncate font-mono">{snapshot.snapshotId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>來源</dt>
            <dd className="truncate">{snapshot.source.sourcePath}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>內容 hash</dt>
            <dd className="truncate font-mono">{snapshot.contentHash.slice(0, 16)}…</dd>
          </div>
        </dl>
      ) : null}

      {snapshot ? <CapabilityList snapshot={snapshot} threadId={brief.threadId} /> : null}

      {trust.state === 'refresh-required' ? (
        <p className="mt-3 rounded-xl bg-secondary/10 px-3 py-2 text-[11px] leading-relaxed text-secondary">
          來源已更新，但既有 snapshot 仍在使用中，不會被自動取代。Refresh 會採用新內容並撤銷全部既有授權。
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {trust.state === 'adopt-required' ? (
          <TrustButton
            busy={busy}
            icon="download"
            label="採用此 plugin"
            onClick={() => run('已採用，尚未授權任何敏感 capability。', () =>
              adoptPluginSnapshot(trust.candidate, projectRoot),
            )}
          />
        ) : null}
        {trust.state === 'refresh-required' ? (
          <TrustButton
            busy={busy}
            icon="refresh"
            label="Refresh 並重新核准"
            onClick={() => run('已更新 snapshot，既有授權已撤銷。', () =>
              refreshPluginSnapshot(trust.candidate, projectRoot),
            )}
          />
        ) : null}
        {trust.state === 'grant-required' ? (
          <TrustButton
            busy={busy}
            icon="verified_user"
            label={`核准 ${trust.denied.length} 項 capability`}
            onClick={() => run('已送出核准請求。', async () => {
              const outcome = await requestCapabilityGrants({
                snapshot: trust.snapshot,
                scope: { threadId: brief.threadId },
                projectRoot: projectRoot,
              })
              if (outcome.denied.length) {
                throw new Error(`仍未授權：${outcome.denied.join('、')}（逾時或拒絕一律 fail closed）。`)
              }
            })}
          />
        ) : null}
        {snapshot && snapshot.grantedCapabilities.length ? (
          <TrustButton
            busy={busy}
            icon="lock_reset"
            label="撤銷全部授權"
            onClick={() => run('已撤銷；下一次執行會重新要求核准。', () =>
              revokePluginGrants(snapshot, projectRoot),
            )}
          />
        ) : null}
      </div>

      {message ? (
        <p className="mt-2 text-[11px] leading-relaxed text-outline" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}

function CapabilityList({ snapshot, threadId }: { snapshot: PluginResolvedSnapshot; threadId?: string }) {
  if (!snapshot.requestedCapabilities.length) {
    return <p className="mt-2 text-[11px] text-outline">此 plugin 沒有要求任何 capability。</p>
  }
  const denied = new Set(deniedCapabilities(snapshot, { threadId: threadId ?? '' }))
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {snapshot.requestedCapabilities.map((capability) => {
        const sensitive = DENY_BY_DEFAULT.has(capability)
        const granted = !denied.has(capability)
        return (
          <li key={capability} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="truncate font-mono text-on-surface">{capability}</span>
            <span className={granted ? 'text-outline' : 'text-secondary'}>
              {!sensitive ? '預設允許' : granted ? '已授權' : '待核准'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function TrustButton({
  busy,
  icon,
  label,
  onClick,
}: {
  busy: boolean
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-medium text-on-surface transition-colors hover:border-primary/35 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

function snapshotOf(trust: PluginTrustState): PluginResolvedSnapshot | null {
  switch (trust.state) {
    case 'adopt-required':
      return null
    case 'refresh-required':
      return trust.stored
    case 'grant-required':
      return trust.snapshot
    case 'trusted':
      return trust.snapshot
  }
}

function stateLabel(trust: PluginTrustState): string {
  switch (trust.state) {
    case 'adopt-required':
      return '尚未採用'
    case 'refresh-required':
      return '來源已更新'
    case 'grant-required':
      return '待核准'
    case 'trusted':
      return '已授權'
  }
}
