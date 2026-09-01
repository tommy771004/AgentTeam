# Codex-aligned Personalization — Qualification status

Updated: 2026-09-01

Status: needs-info / Codex qualified; Claude unqualified

## Evidence availability

本檔保留 implementation qualification 摘要；外部 provider 的最新真機證據由
[`../external-cli-durable-harness/evidence/real-cli-qualification.md`](../external-cli-durable-harness/evidence/real-cli-qualification.md)
承載。2026-08-31 已從 shipped admission／adapter owner 重跑，報告只保存 metadata、hash、lifecycle 與安全 argv，不保存 prompt／output body／credentials。

此證據是 provider-specific qualification，不是整體 release approval。

## Recorded local implementation status

[Ticket 13](issues/13-contract-cleanup-ui-and-release-qualification.md) records
the 2026-08-30 local implementation, build, focused instruction smoke, full smoke,
real Pi Host and UI qualification gates as completed. Original execution and UI
artifacts are not included with this summary; those historical claims have not
been independently revalidated by reconstructing this document.

## External qualification remains open

2026-09-01 fresh real-machine result：

| Provider | Runtime result | Limitation | Qualification |
|----------|----------------|------------|---------------|
| Codex CLI 0.152.0 | exit 0；native marker、checkpoint、restart projection、Turn Record 通過 | provider-owned discovery，Host 仍不宣稱 exact snapshot parity | qualified（native mode） |
| Claude Code 2.1.246 | 實際啟動後 exit 1 | `auth_unavailable` | unqualified |

Codex 的 native-discovery acceptance 已由 shipped path 證實；Claude remains unchecked。不得由 CLI process success 推導 Definition of Done，也不得把 Codex native mode 宣稱為 builtin Pi 的 exact snapshot parity；Claude 未登入時不得冒充已測。完整 metadata-only report 見上方連結。

## Repository-link repair verification

The original failure was reproduced with:

```bash
cd app
node --experimental-strip-types scripts/smoke-tracker-index-links.mts
```

It reported the missing `codex-aligned-personalization-instructions/qualification.md`
target. After this repair, the same existing regression check passed all six
checks (exit code 0), including the real repository index. `git diff --check`
also passed. No smoke assertions or release gates were bypassed or weakened.

This repair did not rerun the full smoke chain, package creation, signing or
publication. It only verifies the reported missing-link blocker.
