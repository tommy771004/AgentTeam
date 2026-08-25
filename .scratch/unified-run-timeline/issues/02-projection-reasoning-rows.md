# 02 — 對話／軌跡投影新增 reasoning row，向後相容

Status: 已完成
Spec: `.scratch/unified-run-timeline/spec.md`

## What to build

對話投影把 `reasoning` entry 投影為一種 row，與 user／assistant／tool／notice 按 seq 順序交錯；軌跡投影因複用同一投影而自動獲得 step 歸屬與 timing。舊格式記錄（無 reasoning entry）的投影輸出必須與現行完全一致——升級不破壞既有封存對話。答案推導語意不變：最後一則 assistant row 仍是答案，reasoning 不參與答案選擇。

**Blocked by:** 01 — Turn Record reasoning entry

## Acceptance criteria

- [x] 投影新增 reasoning row kind，按 seq 與其他 row 交錯、順序正確
- [x] Trajectory rows 自動帶 step 歸屬與（已結束 step 的）timing
- [x] 向後相容斷言：無 reasoning entry 的舊記錄投影輸出與現行完全一致
- [x] 未知 entry 優雅降級為 notice 的機制不被破壞
- [x] 答案推導不受 reasoning row 影響（最後一則 assistant 語意維持）
- [x] Conversation projection smoke 與 trajectory paging smoke 延伸涵蓋上述

## Implementation notes

- `conversationProjection.ts` 新增 `reasoning` row；`trajectoryProjection` 未改一行就取得 step／timing 歸屬（複用同一投影）。
- 向後相容以「整份輸出逐欄相等」斷言，不是抽樣。
- 順手修一個既有缺陷：`notice` entry（Host 寫給使用者看的事實，例如 skills 不可用）原本掉進未知 entry 分支，顯示成「未知的記錄項目：notice」。已知種類落到降級分支是 guard 誤觸發，不是優雅降級——本效應讓它變成使用者看得到的字串，所以在此修正。
- `tool-evidence`（direct-protocol 呼叫的政策生命週期）仍落在未知分支：要讓它在對話中怎麼呈現是另一個決定，本效應不擴張。
