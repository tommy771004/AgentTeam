# Codex-aligned Personalization — Qualification status

Updated: 2026-08-31

Status: needs-info / unqualified

## Evidence availability

本檔保留 implementation qualification 摘要；外部 provider 的最新真機證據由
[`../external-cli-durable-harness/evidence/real-cli-qualification.md`](../external-cli-durable-harness/evidence/real-cli-qualification.md)
承載。2026-08-31 已從 shipped admission／adapter owner 重跑，報告只保存 metadata、hash、lifecycle 與安全 argv，不保存 prompt／output body／credentials。

此證據是 fresh NO-GO qualification，不是 release approval。

## Recorded local implementation status

[Ticket 13](issues/13-contract-cleanup-ui-and-release-qualification.md) records
the 2026-08-30 local implementation, build, focused instruction smoke, full smoke,
real Pi Host and UI qualification gates as completed. Original execution and UI
artifacts are not included with this summary; those historical claims have not
been independently revalidated by reconstructing this document.

## External qualification remains open

2026-08-31 fresh real-machine result：

| Provider | Runtime result | Limitation | Qualification |
|----------|----------------|------------|---------------|
| Codex CLI 0.150.1 | exit 0；checkpoint、restart projection、Turn Record 通過 | native marker 未出現：`native_discovery_unproven` | unqualified |
| Claude Code 2.1.246 | 實際啟動後 exit 1 | `auth_unavailable` | unqualified |

Native-discovery acceptance remains unchecked。不得由 CLI process success 推導 Definition of Done；Claude 也不得在未登入時冒充已測。完整 metadata-only report 見上方連結。

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
