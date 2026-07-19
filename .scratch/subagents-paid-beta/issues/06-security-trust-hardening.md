# 06 — 完成 Electron、Secrets 與資料匯出安全加固

**What to build:** Make the closed-source Local-first product's runtime boundaries and data practices explicit, hardened, and reviewable.

**Blocked by:** None — can start immediately.

**Status:** 已完成

- [x] Production renderer CSP is present and verified for the packaged app.
- [x] Navigation, new-window, external URL, and permission request handling use explicit allowlists and safe schemes.
- [x] Renderer isolation and sandbox decisions are documented and tested.
- [x] Secure-storage-unavailable behavior refuses or clearly gates secret persistence instead of silently using plaintext.
- [x] Settings export redacts secrets and explains sensitive metadata with explicit user consent.
- [x] Dependency audit, secret scan, SBOM review, and security exceptions are part of release qualification.
- [x] Public drafts exist for the security whitepaper, data flow, privacy, retention, deletion, EULA, terms, and refund policies.

**Implementation notes (2026-07-19):**
- `app/electron/securityPolicy.ts` — pure policy: `buildRendererCsp`（sha256-hash 放行內聯 shim、無 unsafe-eval）、`isSafeExternalUrl`（http/https/mailto）、`isAllowedNavigationUrl`、`decidePermissionRequest`（白名單 clipboard-sanitized-write/notifications/fullscreen）、`decideSecretPersistence`（PLAINTEXT_REQUIRED 拒絕）。
- `vite.config.ts` `inject-renderer-csp` plugin：build 注入 CSP meta 至 `dist/index.html`。
- `main.ts`：will-navigate / setWindowOpenHandler / setPermissionRequestHandler(+Check) / `shell:openExternal` 全走 policy。
- `secretsVault.ts`：無 OS 鑰匙圈預設拒絕；`allowPlaintext` 明確同意（learningStore confirm-retry）；migrate 被拒時 legacy localStorage 保留。
- `src/agent/settingsExport.ts`：pattern-based 遮罩 + `bundleSensitivityNotice`；SettingsPage 匯出前 confirm。
- `scripts/security-gates.mjs` + `docs/security-exceptions.json`：依賴稽核（high/critical 擋版、例外含 reason/approvedBy/expires）、祕密掃描；wired into `release.yml` 與 `smoke:ci`（`npm run smoke:security`）。
- Docs：`docs/SECURITY_BASELINE.md`（isolation/sandbox 決策 + drift guard）；`docs/public/`（whitepaper / data flow / privacy / retention+deletion / EULA / terms / refund，皆標示 draft）。
- 驗證：`app/scripts/smoke-security.mts`（純邏輯 + source drift guards + 文件存在性）。
