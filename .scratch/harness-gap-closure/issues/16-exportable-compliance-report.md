# 16 — Export one compliance report covering permissions and egress

**What to build:** Compose the existing governance and outbound evidence into a single exportable document: who was authorised to run what, with which credentials, touching which files, and which tools were blocked.

**Blocked by:** 15 — Show what a run sent outbound.

**Status:** resolved

The governance stack has depth that the compared harness has no counterpart for — `toolPackage.ts` compiles unapproved privilege surfaces read-only and forces re-approval when a fingerprint changes; `modelProfile.ts` carries per-model capability facts with provenance and degrades before calls fail; `secretsVault.ts` keeps tokens in main-process encrypted storage with metadata-only in the renderer; `hooks.ts` rules can only restrict or observe, never allow, and `require-approval` overrides approval mode `full`; `approvalModes.ts` downgrades `full` to `auto` for unattended runs; `entitlement.ts` fails closed to `free` and never throws or silently grants.

That plus outbound is the whole compliance story, and telling it currently requires reading source. It should be one document. Permissions and egress, answered together.

Nothing new is collected — this composes what `security:gates`, `release:qualification`, the smoke evidence ledger, `outbound/evidenceLedger.ts`, and tool-package fingerprints already produce.

- [x] One export produces a document covering a chosen period or run set.
- [x] It records who was authorised to run what, and under which approval mode.
- [x] It records which credentials were referenced, by metadata only — never the secret material.
- [x] It records which files were changed.
- [x] It records which tools were blocked by a fingerprint change and awaited re-approval.
- [x] It includes the outbound egress evidence from ticket 15, so permissions and data flow are answered in one place.
- [x] It records entitlement decisions, including any fail-closed downgrade to `free`.
- [x] Sources are existing output from `security:gates`, `release:qualification`, the smoke evidence ledger, `outbound/evidenceLedger.ts`, and `tools/toolPackage.ts`; no new collection is added.
- [x] The export is reviewable as a document by someone who has not read the source.
- [x] A smoke asserts the exported document contains the expected authorisation, credential-reference, file-change, and blocked-tool entries, and contains no raw secret material.

Files: `app/src/agent/outbound/evidenceLedger.ts`, `app/src/agent/tools/toolPackage.ts`, `app/src/agent/entitlement.ts`, `app/scripts/security-gates.mjs`, `app/scripts/release-evidence.mjs`.

## Comments

- 2026-08-28 tracker reconciliation: `smoke-compliance-report.mts` 覆蓋授權、credential reference、file change、blocked tool 與 secret redaction。

**2026-08-17.** `buildComplianceReport` took every input as a caller-supplied
array and had no caller, so no export existed. Added:
- `complianceReportSources.ts`, which composes the document from the run
  archive, `outbound/evidenceLedger`, `tools/toolPackage` fingerprints and
  `entitlement` — a projection only, no new collection.
- `entitlementDecisions` (including the fail-closed downgrade to `free`),
  `period` / run-set scoping, and `approvalMode` + `unattended` on each
  authorisation.
- A Markdown rendering with six titled sections so a reviewer who has not read
  the source can answer each question, rather than a JSON blob in a fence.
- `ComplianceReportExport` in the Ops console, writing through the same scoped
  project path as learning export.
