# 04 — P2：ContextEngine + Hermes 向壓縮

**What to build:** 建立 ContextEngine interface（preflight compress、protect last N、compress 前 memory flush 等 Hermes 紀律）。Default adapter 收斂現有 governor／pruning／checkpoint 接線，並**重做／對齊 Hermes 向壓縮演算法**（摘要中段、門檻、tool pair 不拆）。FC／loop 改經 interface。

**Blocked by:** 03 — P1：Hermes 全套 Registry（big bang）

**Status:** resolved

- [x] ContextEngine interface 可注入 fake 做真 import 測試
- [x] 生產 default adapter 接上主 loop／governor 呼叫點
- [x] 壓縮不變量：protect last N；tool call/result pair 不拆；必要時 flush-before-compress
- [x] 演算法／門檻變更有 smoke 鎖外部可觀察訊息形狀
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P2 / 決策 16B

## Answer

P2 residual pass (2026-07-20):
- ContextEngine + prepareRound in toolLoop
- `assertToolPairsAdjacent` Hermes pair integrity helper
- Compress body still governor/maybeCompactMessages (thresholds product-owned)

