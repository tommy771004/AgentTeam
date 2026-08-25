# 03 — Live feed 改用 record 投影，活動事件降為 fallback

Status: 已完成
Spec: `.scratch/unified-run-timeline/spec.md`

## What to build

Pi Host run 執行中的時間軸改由 Host 的 live Turn Record 頁投影——與事後軌跡同一個投影函數，live 與 replay 從此同源（同一 record 頁兩次投影必須逐列一致）。推理以收合列內嵌時間軸（預設摺疊、顯示字數、可展開全文）。活動事件通道（thought/text/tool/status）保留，但只服務沒有 Turn Record 的 runner（external CLI）作為 fallback，現行語意不變。

**Blocked by:** 01 — Turn Record reasoning entry；02 — projection reasoning rows

## Acceptance criteria

- [x] Pi 路徑 live 時間軸來自 record 頁投影；同一頁 live 與事後投影逐列一致（同源斷言）
- [x] Reasoning 以收合列內嵌：預設摺疊、顯示字數、展開看全文
- [x] External CLI（無 Turn Record）維持現行活動事件呈現，feed context isolation 語意不變
- [x] Drift guard：Pi 路徑的 live timeline 不得從活動事件合成（仿既有契約檢查，指向新 owner）
- [x] 既有 trajectory paging／feed context isolation smokes 維持綠

## Implementation notes

- Host 新增 `host/record-append` 事件，逐筆帶**已定案的 seq**（`nextTurnRecordSeq` 由 append 與 live publish 共用，兩者不可能各算各的）。
- `src/agent/liveTimeline.ts` 是新 owner：`projectLiveTimeline` 只是 `projectTrajectory(liveTimelinePage(...))` 的組合，刻意不是第二套實作；`runTimelineRows` 把 call/result 摺成一列、丟掉使用者 prompt（上面的氣泡已經是它）、把草稿掛成當前 assistant 列。
- 同源以兩種方式驗證：純函數層（同一頁投影兩次逐列相等）與 Host 端（live 事件與 committed record 的 entries 逐筆相同）。
- Drift guard 在 `smoke-caps.mjs`：活動事件三個 fallback 分支必須被 `!hasRecordTimeline` 擋住，`liveTimeline.ts` 不得認得活動事件詞彙，`piHostActivity.ts` 不得認得 record。
