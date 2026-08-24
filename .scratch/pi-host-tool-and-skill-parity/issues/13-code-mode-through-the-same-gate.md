# 13 — Code Mode 呼叫 extension tools，走同一道閘門

**What to build:** `run_code` 裡巢狀呼叫的工具，跟模型直接呼叫的是同一批工具、過同一道核准。今天 `tools/code` 的 `callTool` 對任何不在 `builtinTools` 裡的名字直接 throw，等於 Code Mode 只看得到 6 個工具 —— 而且一旦放寬，它就可能變成繞過核准的旁路。

**Blocked by:** 12

**Status:** 可交給代理

- [x] `run_code` 的巢狀 `tools.<name>()` 能呼叫 extension tools，不再只限 Pi builtin
- [x] 巢狀呼叫重新進入同一道 Approval Decision，**不得**因為外層已核准就整段放行
- [x] 只有本回合 active 的工具叫得動；其餘回明確錯誤
- [x] 既有的沙箱限制不變（network API 停用、forbidden source 檢查、tool call 上限、timeout）
- [x] 巢狀呼叫在 Turn Record 有自己的座標與 parent 關聯
- [x] 測試在單一接縫，含「巢狀呼叫無法繞過核准」的斷言
