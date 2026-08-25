# 17 — Registration 與 skills 的實際契約與文件／票不一致

**What to build:** 新增工具與 skills 的**實際**契約（build gate 強制的那個）與 `CLAUDE.md`、既有票的說法一致。目前一份文件叫你把檔案加進一個 build gate 明文凍結的目錄，而一張已打勾的票宣稱刪掉了一個仍然存在的檔案。

**Blocked by:** 無。

**Status:** 可交給代理

## 問題

**(a) `CLAUDE.md` 與 contract guard 直接衝突。**

- `CLAUDE.md:45`：「A new tool touches `tools/registered/`, `toolDefinitions.ts`, and an owning capability in `capabilities/builtins.ts`」
- `scripts/check-pi-contract.mts` Guard 1 的失敗訊息：「agent/tools/registered is **frozen** — the Host catalog is the only catalog (ADR-0028). Remove it, or extend this contract explicitly.」

照 `CLAUDE.md` 做的人會撞上 build gate。ADR-0028 之後，新工具的正確路徑是 Host extension pack，`CLAUDE.md` 那段描述的是 ADR-0028 之前的世界。

**(b) `.scratch/pi-host-tool-and-skill-parity/issues/18` 打勾了「刪除 `hermes/skills.ts`」，但檔案還在。**

`src/agent/hermes/skills.ts`（7.5K）仍存在，且 `check-pi-contract.mts` Guard 3 維護一份 4 個消費者的 allowlist，其註解明說它「survives one release READ-ONLY as migration rollback」。

guard 的過渡設計是合理的；**不成立的是票上的勾**。兩者只能擇一為真。

## 驗收條件

- [x] `CLAUDE.md` 的工具章節改寫成 ADR-0028 之後的真實路徑：新工具走 Host extension pack，`tools/registered/` 已凍結且只保留 browser-degrade 與非等價工具。
- [x] 凍結名單的「為什麼」寫在 `CLAUDE.md` 或 ADR，而不是只有 guard 的錯誤訊息知道。
- [x] `pi-host-tool-and-skill-parity/issues/18` 的 `hermes/skills.ts` 條目改為反映真實狀態（read-only 過渡期），或真的完成刪除後才維持打勾。
- [x] 若採過渡期說法，明確寫下它在哪個版本結束、由誰收尾。
- [x] 一個 qualification 證明「照文件走」與「照 gate 走」得到同一個結果 —— 例如文件所述的新增流程，跑得過 `check:pi-contract`。

## Comments

- `CLAUDE.md` 的 Tools 段已重寫：新工具走 `electron/piExtensionPacks/`（並在該目錄 `index.ts` 註冊）＋ `capabilities/builtins.ts` 的擁有 capability；`src/agent/tools/registered/` 與 `toolDefinitions.ts` 明講是**renderer seam 且已凍結**，留下的只有 Host 不擁有的非等價 `workspace_*` 與 plain-browser degrade。凍結的「為什麼」現在寫在文件裡，不再只有 guard 的錯誤訊息知道。
- `pi-host-tool-and-skill-parity/issues/18` 的 `hermes/skills.ts` 條目已從 `[x]` 改為 `[~]`，寫明它以 READ-ONLY 留存一個版本、由 Guard 3 凍結消費者，收尾指向本票。
- **新增 Guard 5**：`check-pi-contract.mts` 現在讀 `CLAUDE.md` 的 Tools 段，要求它同時提到 `piExtensionPacks` 與「凍結」。實測把文件裡的路徑改錯 → `check:pi-contract` 失敗；改回 → 通過。文件與 gate 不一致這件事本身現在會讓 build 失敗，這就是「照文件走 == 照 gate 走」的可執行證明。
- Guard 1 原本是套套邏輯（`FROZEN_REGISTERED` 重讀同一個目錄，兩邊一起長大，只有新的 `workspace_*` 檔名能讓它失敗）。已在本次修正為明列 39 個檔名的真實凍結，並實測新增任意檔案會讓 `check:pi-contract` 失敗。**這張票處理的是剩下的文件面不一致。**
