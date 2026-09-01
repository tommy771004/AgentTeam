# 08 — Revision side-by-side diff

**What to build:** 任兩個 revision 可逐檔並排 diff：讀兩份快照做文字比較，結果為 UI-ready 的結構化差異（新增/刪除/變更行），在 Studio 的 revision 選擇處即可觸發。使用者在採用前看得懂 agent 到底改了什麼。

**Blocked by:** 07 — Register 快照 + restore 成新 revision + live guard

**Status:** resolved

- [x] Diff 以快照為來源，回傳結構化逐檔差異（新增/刪除/變更）
- [x] 任兩個 revision 可選取比較，含跨多版（非僅相鄰）
- [x] UI 呈現遵循既有 artifact 檢視文法；無快照的 revision 顯示不可比較而非錯誤
- [x] Store-level smoke 斷言 diff 結構與已知輸入的預期差異

## Comments

**2026-09-01 qualification closure**：`ArtifactRevisionDiff` 可選任意兩個有快照的 revision，store 從 snapshot paths 讀內容後輸出 added／removed／changed／context rows；缺少快照回傳不可比較訊息。`smoke-subdesign-artifact-snapshots.mts` 已以 r1→r4 跨版、多檔案 fixture 驗證。
