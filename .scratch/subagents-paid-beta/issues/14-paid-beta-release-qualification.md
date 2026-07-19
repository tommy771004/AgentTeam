# 14 — 執行 Paid Beta Go/No-Go Release Qualification

**What to build:** Qualify a real signed Windows and macOS release artifact through the complete install, recovery, entitlement, workflow, and trust journey before marking Paid Beta ready.

**Blocked by:** 03 — 完成 Clean-install CLI Doctor 與首次任務; 05 — 建立安全更新與 N-1→N Migration; 06 — 完成 Electron、Secrets 與資料匯出安全加固; 09 — 交付簽章 Subscription Feature Pack; 12 — 交付 Spec → Tickets → TDD → Review 訂閱工作流; 13 — 發布產品網站與閉源信任文件.

**Status:** blocked-pending-real-signed-platform-evidence

- [ ] Windows 10/11 and macOS supported architectures install and launch signed artifacts on clean machines.
- [ ] First-run CLI doctor and a real local coding task complete on each platform.
- [ ] Restart, forced crash recovery, queue exactly-once, and scheduler once-job evidence pass.
- [ ] N-1→N update, signature verification, failed-update recovery, and rollback evidence pass.
- [ ] Free Core, active Pro, offline grace, expired/cancelled entitlement, and feature-pack rollback evidence pass.
- [ ] Spec → Tickets → TDD → Review → Artifact Index → user-selected Handoff completes with user approval before release actions.
- [ ] Privacy, security, EULA, terms, refund, support, release notes, checksums, SBOM, and provenance links are present.
- [x] Any remaining warning, known issue, or platform limitation is recorded in the release report with owner and mitigation.
- [x] Release is marked Go only when every P0 criterion has stored evidence; otherwise it remains No-Go.

Implementation note: `app/src/agent/releaseQualification.ts`, `app/scripts/release-qualification-input.mts`, `app/scripts/qualify-release.mts`, and the aggregate `release-qualification` GitHub Actions job enforce this fail-closed rule. Current stored report: `.scratch/subagents-paid-beta/evidence/14-paid-beta-release-qualification-no-go.md`. The first seven checks remain open until real signed Windows/macOS artifacts and their clean-machine evidence are supplied.
