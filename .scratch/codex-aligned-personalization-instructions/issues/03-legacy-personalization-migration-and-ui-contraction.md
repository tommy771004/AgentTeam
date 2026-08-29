# 03 — 舊個人化資料遷移與重複 UI contraction

**What to build:** 把既有 personality、關於使用者、回覆偏好、SOUL 與內部 AGENTS stable prompt 安全遷移到新的 Personalization authority，然後移除 Learning 中容易被誤認為實體專案檔案的重複編輯入口；升級後使用者的既有行為不消失，也不再有兩個 owner。

**Blocked by:** 02 — 全域指令 run snapshot 與 Turn Record.

**Status:** 可交給代理

- [x] Migration 將既有 personality、about-user 與 response-style 語意保留到新的 Host projection。
- [x] Legacy SOUL 遷移為進階人格指令，legacy internal AGENTS 遷移為全域自訂指令，空白與未設定維持不同語意。
- [x] Migration data、source hash 與 marker 在同一 transaction commit，重啟重跑不重複匯入。
- [x] Cutover 前保存可診斷的 backup/report；失敗時舊 live data 不被清空或誤判為無設定。
- [x] 「個人化」成為唯一一般使用者編輯入口，Learning 的重複「人格與上下文」入口在 cutover 後移除。
- [x] UI 文案不再把 DB-owned global instruction 稱為 project AGENTS file。
- [x] 舊 renderer write path 被 contract／drift guard 禁止復活，read compatibility 只保留到 migration qualification 收口。
- [x] Migration fixtures、restart smoke 與 renderer smoke 證明資料保留、入口收斂與實際 run 行為不回歸。
