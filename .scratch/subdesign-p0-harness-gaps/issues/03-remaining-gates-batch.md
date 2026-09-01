# 03 — 其餘 gates 批次：console-error / build-success / responsive overflow / token-consistency

**What to build:** 依 02 的模式補齊其餘四個 deterministic design gates：console error（預覽執行期錯誤）、build success（建構驗證）、responsive overflow（窄視窗無水平溢出）、token consistency（與 brief 約束的 token 對照）。使用者得到的改變：critique 的四項分數全部有 gate 量測對應，fail-closed 合約完整生效。

**Blocked by:** 02 — 第一個 gate：state-aware contrast，端到端

**Status:** resolved

- [x] 四個 gates 各自註冊、stage 限制、結構化輸出與 `'gate'` evidence 寫入，皆比照 contrast gate
- [x] 每個 gate 有獨立的 store-level smoke（量測成功 + 失敗路徑）
- [x] Tool registry drift guard 更新涵蓋全部五個 gates
- [x] 全部就位後：pass verdict 必然代表五項 gate 皆已執行且通過（或 blocker 明確列出）

## Comments

**2026-09-01 production closure**：console-error、build-success、responsive-overflow、token-consistency 已與 contrast 一併列入 `design-critique` capability。共同 execute boundary 僅接受 Critique stage；smoke 逐一執行五個工具的 Host pass／fail 路徑，並固定模型無法覆寫 Host measurement。
