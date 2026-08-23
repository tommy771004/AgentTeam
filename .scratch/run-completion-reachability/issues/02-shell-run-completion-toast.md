# 02 — 殼層全域完成通知(toast + OS notify)

**What to build:** 任一 run 從 live 轉 terminal 的瞬間,不論使用者當下在哪個畫面,app 發出一次 OS notification(經既有 app:notify bridge)並在殼層顯示自動消失的 toast。使用者切去別的 page 等長任務時,完成的那一刻有信號。抑制規則:該 run 的 process feed 目前可見、或該 thread 正是當前活躍 thread → 不重複打擾。多個 run 接連完成時 toast 堆疊上限 3 則、超出合併為「N 個任務已完成」;OS notify 可在設定中靜音(thread 內訊息不受影響)。失敗/中止走同路徑、不同樣式。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Layout 層由 per-run registry 的下降緣驅動,對每個剛 terminal 的 runId 觸發一次通知;store 不新增第二事實來源
- [x] toast 元件位於 primitives 層:自動消失、堆疊上限 3、超出合併計數
- [x] 抑制正確:正在看該 run feed 或正在該活躍 thread 時不出 toast(仍可有 OS notify,受設定控制)
- [x] 失敗/中止樣式與成功可區分(error 色 / 文案)
- [x] 點擊 toast 導向該 thread 或其 run 面板
- [x] 設定提供 OS notify 開關;關閉後 thread 內訊息與 in-app toast 不受影響
- [x] SubDesign build/critique 完成同樣觸發(同一 registry,無特例)
- [x] smoke 斷言觸發/抑制組合的判定邏輯(shipped-module import,不 inline 重寫)

## 實作備註

- 溢位列文案改為「另有 N 個任務已結束」，而非規格寫的「N 個任務已完成」。堆疊裡可能同時包含失敗與中止的 run，對它們宣稱「已完成」會違反本批 ticket 一貫的誠實原則（見 01 與 04）。
- OS notify 開關沿用既有 `settings.notifyOnComplete`，未新增設定欄位；設定說明已改寫成「只停系統通知，不影響對話訊息與 app 內提示」。
- 原本 `App.tsx` 以彙總 `isRunning` 下降緣觸發的完成通知已移除，改由 per-run registry 驅動，避免第二事實來源（並修好並行 run 只在全部閒置時才通知一次的舊行為）。
- Toast 點擊導向後會自動關閉該張卡片。
- 進場動畫位移縮到 10px（小於 16px 的邊距）：分頁在背景時 document timeline 會凍結在第一幀，位移必須仍留在視窗內；`prefers-reduced-motion` 下完全不套用動畫。
