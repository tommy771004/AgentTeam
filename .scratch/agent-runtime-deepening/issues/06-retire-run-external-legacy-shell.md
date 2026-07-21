# 06 — 退役 runExternal 殘殼

**What to build:** 兩輪已完成的 task-run 遷移已經把 legacy 相容檔案掏空到只剩四塊：canonical 執行請求／結果型別、一個 OpenCode session 對照 helper、一個無人使用的再匯出區塊、兩個零呼叫者的相容函式。全量清理：型別遷移到一個中性的既有型別模組（避免在 task-run policy 模組與 coordinator 模組之間造出新的循環型別依賴）；OpenCode helper 遷移到既有 OpenCode 專屬模組；死碼直接刪除；legacy 檔案整個刪除。既有針對這個檔案的大量字串斷言（含一條因副檔名疏漏而假性通過、完全沒抓到 coordinator 其實動態拉回這個「legacy」模組的斷言）全部重寫指向新落點。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `ExternalRunOpts`／`ExternalRunResult`／`RunSourceKind`／`RunTaskInput` 型別遷移到中性的既有型別模組（不是 coordinator 模組本身，避免與 task-run policy 模組互相依賴）。
- [x] OpenCode session 對照 helper 遷移到既有 OpenCode 專屬模組。
- [x] 死碼直接刪除：零呼叫者的相容函式、無人使用的再匯出區塊——確認全 repo 零消費者後刪除，不經過棄用期。
- [x] legacy 檔案整個刪除。
- [x] 既有針對這個檔案的字串斷言全部改為讀取新落點，維持相同測試意圖；確認死碼已刪除的斷言直接移除（檔案不存在本身就是更強保證）。
- [x] 修正一條先前因副檔名疏漏而假性通過的斷言，改用不受副檔名影響的寫法，確認 coordinator 真的沒有殘留引用。
- [x] `npm run build`（型別搬家後所有消費端 import path 由編譯器逼出）、`npm run smoke`（重寫後套件）、`npx oxlint src` 全綠、全 repo grep 確認零殘留引用。

## Comments

### Grilling session 決策摘要（2026-07-20）

- 範圍決定：全量清理（而非只刪明確死碼、暫留檔案本體與 OpenCode helper）。
- 具體驗證過的 bug：既有 smoke 斷言 `assert.doesNotMatch(coordinator, /await import\('\.\/runExternal'\)/)` 因為實際程式碼寫的是 `await import('./runExternal.ts')`（含副檔名），regex 副檔名不match，導致這條「coordinator 不可動態拉回 legacy 模組」的斷言現在是假性通過——已直接跑過 regex 驗證確認。
- 型別落點決定為中性型別模組而非 coordinator 模組本身：查證過該中性模組零 import（純葉節點），可避免新增 coordinator↔policy 循環依賴。
- 不開 ADR：可逆內部重構。

## Answer

Implemented 2026-07-20:

- Types → `app/src/agent/taskRunTypes.ts` (neutral)
- `syncOpenCodeSessionMapping` → `opencode/sessionMapping.ts`
- Deleted `runExternal.ts` (dead adapters + re-exports)
- Smoke: extension-agnostic `import('./runExternal(?:\.ts)?')` + file-absence asserts
