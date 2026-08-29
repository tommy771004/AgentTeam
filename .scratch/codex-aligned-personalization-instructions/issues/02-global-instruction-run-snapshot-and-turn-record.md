# 02 — 全域指令 run snapshot 與 Turn Record

**What to build:** 讓已儲存的全域自訂指令真正進入 builtin Pi 的下一個 Task run：Host 在唯一 admission 流程解析並凍結 instruction snapshot，模型先取得 standing instructions、再取得當前請求，而且 Turn Record 能精確重建該次模型實際看見的有效文字與來源。

**Blocked by:** 01 — Host-owned 全域自訂指令 vertical slice.

**Status:** 可交給代理

- [x] 每個 builtin Task run admission 取得一個 immutable instruction snapshot identity、revision 與 effective hash。
- [x] 全域自訂指令在當前請求之前注入，當前請求保持在最後的 salient 位置。
- [x] 同一 Task run 的所有 Loop iteration 使用相同 snapshot，不從 mutable settings 重新讀取。
- [x] 新的 Host-authored Turn Record entry 保存有效 model-visible instruction text、source kind、revision、hash 與解析診斷。
- [x] Replay 不需重讀目前 SQLite 值，即可重建歷史 run 的有效指令內容。
- [x] Managed policy、Approval Decision、capability 與 Outbound Data Gate authority 不可被自訂指令改寫。
- [x] Temporary chat 仍套用 explicit global instructions，但不因此重新啟用 durable memory。
- [x] Real Pi Host smoke 以可辨識規則驅動一個 Task run，斷言模型輸入順序、record fidelity 與 restart replay。
