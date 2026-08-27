# 07 — State-changing tool 的 Skill preflight pass-through

**What to build:** 在 state-changing tool 真正執行前建立 Host-controlled Skill preflight。當 invocation policy 判定不需載入 Skill 時，工具正常執行且留下 bounded、可追溯的零命中決策。

**Blocked by:** 03 — Blocked state 與 CAS revision conflict

**Status:** 完成

- [x] State-changing classification 來自 frozen Host tool contract 與 policy metadata，不以模型提供的 tool name regex 決定。
- [x] Preflight key 使用 Working State revision、pending goal identities、constraints、blocker、immutable tool identity 與 bounded draft characteristics。
- [x] Read-only calls 預設不承擔 preflight，除非 tool contract 明確要求。
- [x] 零 Skill 命中時原 tool call 正常通過既有 Approval Decision、Execution evidence 與 settlement 路徑。
- [x] Turn Record 記錄 invocation trigger、retrieval key digest、對應 goal IDs、零命中與 active package identity，不複製完整 transcript。
- [x] Durable memory 僅能透過其 public versioned protocol 被查詢；本票不修改 SQLite schema、adapter、migration 或 memory UI authority。
- [x] 真實 Host tool smoke 證明 pass-through 沒有第二 executor 或 renderer gate，並已加入實際 smoke gate。
