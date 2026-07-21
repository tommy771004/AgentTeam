/**
 * Policy Admin settings surface (ADR-0016).
 * Extracted from SettingsPage — only meaningful on policy-admin build flavor.
 */
import { useEffect, useState } from 'react'
import {
  PillSelect,
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  settingsBtnCls,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from './SettingsChrome'

type ActiveRow = {
  kind: string
  connectionId?: string
  version: number
  changeId: string
  detectorCount: number
}

type DraftRow = {
  id: string
  kind: string
  connectionId?: string
  updatedAtUtc: string
  version?: number
  changeId?: string
}

export function PolicyAdminSection(props: { isPolicyAdminBuild: boolean }) {
  const { isPolicyAdminBuild } = props
  const [policyAdminMsg, setPolicyAdminMsg] = useState<string | null>(null)
  const [policyActive, setPolicyActive] = useState<ActiveRow[]>([])
  const [policyDrafts, setPolicyDrafts] = useState<DraftRow[]>([])
  const [policyDraftId, setPolicyDraftId] = useState('company-base-draft')
  const [policyDraftKind, setPolicyDraftKind] = useState<
    'company-base' | 'provider-supplement'
  >('company-base')
  const [policyDraftConn, setPolicyDraftConn] = useState('')
  const [policyDraftJson, setPolicyDraftJson] = useState('')
  const [policyBusy, setPolicyBusy] = useState(false)

  const refreshPolicyAdmin = async () => {
    try {
      const [active, drafts] = await Promise.all([
        window.subagents?.outbound?.policyListActive?.() ?? [],
        window.subagents?.outbound?.policyListDrafts?.() ?? [],
      ])
      setPolicyActive((active || []) as ActiveRow[])
      setPolicyDrafts((drafts || []) as DraftRow[])
    } catch (e) {
      setPolicyAdminMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (!isPolicyAdminBuild) return
    void refreshPolicyAdmin()
  }, [isPolicyAdminBuild])

  if (!isPolicyAdminBuild) {
    return (
      <SettingsGroup title="不可用">
        <SettingsRow
          title="需要 policy-admin build"
          description="請以 SUBAGENTS_BUILD_FLAVOR=policy-admin 打包。standard 不會暴露政策寫入面。"
          control={<span className="text-[11px] text-outline">standard</span>}
        />
      </SettingsGroup>
    )
  }

  return (
    <>
      <SettingsGroup title="使用中政策（非敏感摘要）">
        <SettingsRow
          title="重新整理"
          description={policyAdminMsg || '列出 company-base 與 provider supplements。'}
          control={
            <button
              type="button"
              className={settingsBtnCls}
              disabled={policyBusy}
              onClick={() => void refreshPolicyAdmin()}
            >
              重新整理
            </button>
          }
        />
        {policyActive.length === 0 ? (
          <SettingsRow
            title="尚無 active 檔"
            description="啟用草稿後會寫入政策目錄。"
            control={<span className="text-[11px] text-outline">—</span>}
          />
        ) : (
          policyActive.map((p) => (
            <SettingsRow
              key={`${p.kind}:${p.connectionId || 'base'}`}
              title={
                p.kind === 'company-base'
                  ? 'Company Base'
                  : `Supplement · ${p.connectionId || '—'}`
              }
              description={`v${p.version} · ${p.changeId} · detectors ${p.detectorCount}`}
              control={
                p.kind === 'company-base' || p.connectionId ? (
                  <button
                    type="button"
                    className={settingsBtnCls}
                    disabled={policyBusy}
                    onClick={() => {
                      void (async () => {
                        setPolicyBusy(true)
                        setPolicyAdminMsg(null)
                        try {
                          const r = await window.subagents?.outbound?.policyRollback?.({
                            kind: p.kind as 'company-base' | 'provider-supplement',
                            connectionId: p.connectionId,
                            reason: 'settings-ui-rollback',
                          })
                          setPolicyAdminMsg(
                            r?.ok
                              ? `rollback OK → v${(r.active as { version?: number })?.version}`
                              : `rollback failed: ${(r as { reason?: string })?.reason}`,
                          )
                          await refreshPolicyAdmin()
                        } catch (e) {
                          setPolicyAdminMsg(e instanceof Error ? e.message : String(e))
                        } finally {
                          setPolicyBusy(false)
                        }
                      })()
                    }}
                  >
                    Rollback+1
                  </button>
                ) : (
                  <span className="text-[11px] text-outline">—</span>
                )
              }
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title="草稿">
        <SettingsRow
          title="Draft kind"
          description="company-base 或 provider-supplement（後者需 connection id）。"
          control={
            <PillSelect
              value={policyDraftKind}
              onChange={(v) =>
                setPolicyDraftKind(
                  v === 'provider-supplement' ? 'provider-supplement' : 'company-base',
                )
              }
              className="min-w-[11rem]"
            >
              <option value="company-base">company-base</option>
              <option value="provider-supplement">provider-supplement</option>
            </PillSelect>
          }
        />
        <SettingsRow
          title="Draft id"
          description="儲存草稿不會自動啟用。"
          control={
            <input
              className={settingsInputCls + ' min-w-[10rem]'}
              value={policyDraftId}
              onChange={(e) => setPolicyDraftId(e.target.value)}
            />
          }
        />
        {policyDraftKind === 'provider-supplement' && (
          <SettingsRow
            title="Connection id"
            description="例如 llm:openai:… 或從 active supplement 列表複製。"
            control={
              <input
                className={settingsInputCls + ' min-w-[12rem]'}
                value={policyDraftConn}
                onChange={(e) => setPolicyDraftConn(e.target.value)}
                placeholder="llm:…"
              />
            }
          />
        )}
        <SettingsRow
          title="從 active 種子草稿"
          description="複製目前 active 政策並將 version+1 寫入 drafts/。"
          control={
            <button
              type="button"
              className={settingsBtnCls}
              disabled={
                policyBusy ||
                !policyDraftId.trim() ||
                (policyDraftKind === 'provider-supplement' && !policyDraftConn.trim())
              }
              onClick={() => {
                void (async () => {
                  setPolicyBusy(true)
                  setPolicyAdminMsg(null)
                  try {
                    const r = await window.subagents?.outbound?.policySeedDraft?.({
                      kind: policyDraftKind,
                      connectionId:
                        policyDraftKind === 'provider-supplement'
                          ? policyDraftConn.trim()
                          : undefined,
                      draftId: policyDraftId.trim(),
                    })
                    if (r?.ok) {
                      const loaded = await window.subagents?.outbound?.policyReadDraft?.(
                        policyDraftId.trim(),
                      )
                      if (loaded && loaded.ok) {
                        setPolicyDraftJson(
                          JSON.stringify(
                            (loaded.draft as { body?: unknown })?.body ?? loaded.draft,
                            null,
                            2,
                          ),
                        )
                      }
                      setPolicyAdminMsg(`draft seeded (${policyDraftKind})`)
                      await refreshPolicyAdmin()
                    } else {
                      setPolicyAdminMsg(`seed failed: ${(r as { reason?: string })?.reason}`)
                    }
                  } catch (e) {
                    setPolicyAdminMsg(e instanceof Error ? e.message : String(e))
                  } finally {
                    setPolicyBusy(false)
                  }
                })()
              }}
            >
              Seed
            </button>
          }
        />
        <SettingsStack title="Draft JSON（body）">
          <textarea
            className={settingsInputCls + ' w-full font-mono text-[11px]'}
            rows={12}
            value={policyDraftJson}
            onChange={(e) => setPolicyDraftJson(e.target.value)}
            placeholder='{ "schemaVersion": 1, "kind": "company-base" | "provider-supplement", ... }'
          />
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className={settingsBtnCls}
              disabled={
                policyBusy ||
                !policyDraftId.trim() ||
                !policyDraftJson.trim() ||
                (policyDraftKind === 'provider-supplement' && !policyDraftConn.trim())
              }
              onClick={() => {
                void (async () => {
                  setPolicyBusy(true)
                  setPolicyAdminMsg(null)
                  try {
                    const body = JSON.parse(policyDraftJson) as unknown
                    const r = await window.subagents?.outbound?.policySaveDraft?.({
                      id: policyDraftId.trim(),
                      kind: policyDraftKind,
                      connectionId:
                        policyDraftKind === 'provider-supplement'
                          ? policyDraftConn.trim()
                          : undefined,
                      body,
                    })
                    setPolicyAdminMsg(
                      r?.ok ? 'draft saved' : `save failed: ${(r as { reason?: string })?.reason}`,
                    )
                    await refreshPolicyAdmin()
                  } catch (e) {
                    setPolicyAdminMsg(e instanceof Error ? e.message : String(e))
                  } finally {
                    setPolicyBusy(false)
                  }
                })()
              }}
            >
              儲存草稿
            </button>
            <button
              type="button"
              className={settingsBtnPrimaryCls}
              disabled={policyBusy || !policyDraftId.trim()}
              onClick={() => {
                void (async () => {
                  setPolicyBusy(true)
                  setPolicyAdminMsg(null)
                  try {
                    const r = await window.subagents?.outbound?.policyActivateDraft?.(
                      policyDraftId.trim(),
                    )
                    setPolicyAdminMsg(
                      r?.ok
                        ? `activated v${(r.active as { version?: number })?.version}`
                        : `activate failed: ${(r as { reason?: string })?.reason}`,
                    )
                    await refreshPolicyAdmin()
                  } catch (e) {
                    setPolicyAdminMsg(e instanceof Error ? e.message : String(e))
                  } finally {
                    setPolicyBusy(false)
                  }
                })()
              }}
            >
              啟用草稿
            </button>
          </div>
        </SettingsStack>
        {policyDrafts.length > 0 && (
          <SettingsStack title="既有草稿">
            {policyDrafts.map((d) => (
              <SettingsRow
                key={d.id}
                title={d.id}
                description={`${d.kind} · v${d.version ?? '—'} · ${d.changeId || '—'} · ${d.updatedAtUtc || ''}`}
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => {
                      void (async () => {
                        setPolicyDraftId(d.id)
                        const loaded = await window.subagents?.outbound?.policyReadDraft?.(d.id)
                        if (loaded?.ok) {
                          setPolicyDraftJson(
                            JSON.stringify(
                              (loaded.draft as { body?: unknown })?.body ?? loaded.draft,
                              null,
                              2,
                            ),
                          )
                        }
                      })()
                    }}
                  >
                    載入
                  </button>
                }
              />
            ))}
          </SettingsStack>
        )}
      </SettingsGroup>
    </>
  )
}
