# 01 — Packaged change evidence schema

**What to build:** 讓 packaged first-task evidence 的 producer、release consumer 與使用者可見 change presentation 共用同一版本化契約。使用者能看到變更檔案、總增刪行與有界程式碼 preview，正常畫面不出現 raw Git patch headers。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Evidence 宣告 schema version，並包含 change visibility、changed-file count、aggregate additions/removals 與 bounded preview。
- [x] Release consumer 驗證結構化 change evidence，不再讀取已退役欄位或要求 `diff --git`、`---`、`+++`、`@@`。
- [x] Shipped packaged-runtime smoke 證明真實變更可見，且不是由任意 fixture 字串冒充。
- [x] Current、legacy、missing-field 與 malformed evidence 都有明確 pass／migration／fail-closed 結果。

## Comments

- 2026-08-31：新增 schema v2 與共用 producer／validator；packaged app 從 Run Review Snapshot 的實際 add/remove rows 產生 bounded preview，release-ready 與 Paid Beta qualification input 共用同一 validator。
- 2026-08-31：legacy evidence 以缺少 `schemaVersion` 明確回報 migration；current、missing-field、malformed、raw-header 與 verifier CLI 均有 fail-closed behavior tests。
- 2026-08-31 驗證：`npm run build`、完整 `npm run smoke`、`npm run smoke:packaged-change-evidence`、`npm run smoke:release-qualification`、`npm run smoke:install`、focused oxlint、`check-pi-contract.mts`、`git diff --check` 全綠。完整 smoke 包含 Review Workspace rendered/Electron E2E 與 Pi Electron reattach 2 active + 2 terminal cases。
- 2026-08-31 code review：Standards／Spec 雙軸複核最終無剩餘 finding；review 修正後 focused smokes 與 gate reachability guard 再次通過。
