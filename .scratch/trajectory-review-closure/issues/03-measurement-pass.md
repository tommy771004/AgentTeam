# 03 — 量測 pass＋證據＋trf#10 收口指向

**What to build:** 在真 app 裡以注入 `loadPage` 餵一份數千列 fixture 帳本，量測虛擬化前後的 DOM 節點數與捲動品質；數字連環境說明落在本 effort 目錄，並據此定 overscan 預設。fail-closed：證據文件不存在或無數字，本票不得勾。

**Blocked by:** 01, 02

**Status:** 需人工處理

本票本質是 spec 明文規定的人工證據（「量測 pass 是人工證據，不是 smoke」，比照 release qualification No-Go 慣例）。代理交付：fixture 產生器、量測程序文件、以及一切可機器證明的半部（見 01）。真機量測與 overscan 定案需有人在實際 app 操作。

## 驗收條件

- [x] fixture 帳本產生器存在且可重跑。
- [x] 量測程序文件存在：步驟、要量的數字、判讀方式。
- [ ] 證據文件（含 before/after DOM 節點數與環境說明）落在本目錄。
- [ ] overscan 預設由量測結果背書（或維持預設並記錄理由）。
- [x] turn-record-fidelity #10 的 `[~]` 項更新為指向本 effort 證據。（指向已補；勾選以證據落地為準）

## Comments

**代理交付（2026-08-26）。**

- fixture 產生器：`app/scripts/trajectory-measurement-fixture.mts` — 純記憶體帳本，走與 `pageTurnRecord` 完全相同的分頁契約（before 為排他上界、`nextBefore`、`hasOlder`、`total`）；已用一次性腳本斷言分頁語意正確（新頁／舊頁／起點頁）。
- 程序文件：本目錄 `measurement-pass.md` — 臨時掛載 snippet、要量的四個數字（含實際列高以校正 `TRAJECTORY_ROW_HEIGHT=30`）、判讀表。
- trf#10 已補指向註記。

**剩餘兩框需真機操作**（DevTools DOM 計數＋主觀捲動品質），依 spec 屬人工證據，fail-closed：無數字不勾。
