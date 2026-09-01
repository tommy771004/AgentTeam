# 04 — Critique theater 顯示分數溯源

**What to build:** Critique theater 的每項分數旁顯示產生它的 gate 記錄：gate id、執行時間戳、量測值摘要，可展開檢視。使用者（reviewer）可以逐項查帳——「這個 92 分是誰量的、什麼時候量的」。本票只做只讀呈現；evidence 裡沒有 gate 條目時顯示「not verified」狀態而非隱藏。

**Blocked by:** 01 — Gate evidence contract + fail-closed verdict

**Status:** resolved

- [x] 每項分數旁呈現對應 gate 記錄（id、時間戳、量測值）
- [x] 無 gate 條目的分數明確標示未驗證，不偽裝成已驗證
- [x] 元件層 fixture 驗證有/無 gate 證據兩種呈現狀態
- [x] 呈現遵循既有 critique UI 的視覺文法與 reduced-motion fallback

## Comments

**2026-09-01 production closure**：`CritiquePanel` 的每項分數會依 canonical score↔gate map 顯示可展開記錄，包含量測摘要、時間、證據 path 與 SHA-256 摘要；沒有對應 evidence 時固定顯示 `not verified`。呈現只使用原生 details/summary，沒有新增動畫，helper smoke 同時驗證有／無 evidence。
