# 08 — Skill 命中後的 not-executed redraft

**What to build:** 當 Skill preflight 命中必要 Skill 時，Host 阻止原 tool draft、記錄 not-executed outcome，將精確 immutable Skill revision 注入下一次模型 request，再只允許新的 tool call 執行。

**Blocked by:** 07 — State-changing tool 的 Skill preflight pass-through

**Status:** 完成

- [x] Invocation policy 預設選擇零或一個 Skill；第二個 Skill 需要明確 reason 與 hard context budget。
- [x] 命中時原 call 在任何 approval 或 side-effect executor 前停止，且不產生 execution evidence 或成功 settlement。
- [x] Host 發出可辨識的 synthetic not-executed result，說明 Skill preflight 已介入而非工具執行失敗。
- [x] 下一個模型 request 包含精確 Skill id、version、digest 與 bounded body，並要求產生 fresh call identity。
- [x] 原 call identity 即使被模型或 transport 重送也不能執行；只有 redrafted call 能進入正常 tool lifecycle。
- [x] Turn Record 能證明 Skill revision 確實位於原 draft 與新 call 之間，且 live/replay 順序一致。
- [x] Controlled model Host smoke 證明原 call 零副作用、新 call 正常執行，並已加入實際 smoke gate。
