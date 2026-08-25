# 11 — ADR-0047 真實 Pi turn denial qualification

**What to build:** Strict-mode 使用者在沒有 verified filesystem isolation 時，透過真實 Pi turn 觸發 builtin `bash` 會在 Host in-turn seam 被拒絕，command 不會產生任何 side effect，且 decision、result 與 durable Turn Record 都誠實說明 ADR-0047 的原因。

**Blocked by:** 05 — 真實 Pi tool-call qualification 與 contract identity.

**Status:** 可交給代理

- [x] Shipped Host 在 Outbound Guard `required` 下由 deterministic provider 產生真實 builtin bash tool call。
- [x] Fixture command 若執行會留下可觀察 side effect；qualification 證明該 side effect 不存在。
- [x] Host 發出 deny decision、denied settlement 與 matching tool result，沒有 success output。
- [x] Turn Record 保留相同 runId、callId、contract identity 與 outbound-shell evidence。
- [x] Missing viewRoot、missing isolation evidence、malformed isolation evidence 都維持 fail closed。
- [x] Optional 與 off 的既有差異被保留，degraded lexical checks 不被描述為 sandbox。
- [x] ADR-0047 更新為目前 Host-side owner，移除指向已刪 renderer handler 的過時說明。
- [x] 外部行為 qualification 通過後，重疊的 source-text wiring assertion 被移除或縮減為必要 drift guard。

## Comments

- Shipped Pi Host 與 deterministic provider 的真實 turn 會產生 builtin `bash` call；`required` 且無 verified isolation 時只留下唯一 composed deny/denied terminal，fixture 寫檔副作用不存在。
- Turn Record 與 shell evidence 的 runId、callId、revision、contract/schema digest、source/origin 均一致；blocked `tool_execution_end` 不再重複寫入 terminal result。
- Qualification 同時覆蓋 missing viewRoot、missing/malformed isolation fail closed，以及 optional degraded/off unrestricted 的既有差異。
- ADR-0047 已改指 Host `piBashGateExtensionFactory` owner；舊 wiring source assertion 已移除，只保留 policy/IPC drift guard。
- 主代理獨立重跑 `npm run smoke:pi-adr0047-real-turn` 與 `git diff --check`，全部通過；Ticket 10 all-origin regression 與完整 build 亦已由實作代理通過。
