# 03 — Vision compaction 保留原始圖片

Status: 可交給代理
Spec: `.scratch/run-path-correctness/spec.md`

## What to build

上下文壓縮目前先把全部訊息 flatten 成純文字（圖片變 `'[image]'`）再壓縮，導致壓縮產物整體替換 live transcript 後，連刻意逐字保留的近期訊息也失去圖片。本票重構 context governor beforeRound 的資料流：(1) compact 收到未破壞的原始訊息陣列；(2) 純文字化只發生在被摘要捨棄的舊段落在壓縮器內部；(3) transcript 含影像且非溢出情境時跳過 parity 觸發的壓縮、原樣返回；(4) overflow 情境仍壓縮，但壓縮器刻意保留的近期訊息必須原樣通過（含 image parts）——不得破壞 OpenCode compaction 對保留段的逐字原樣承諾；(5) 「含影像無法壓縮」日誌只在真的跳過壓縮時記錄，日誌與行為一致。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [ ] Governor 的注入式 deps 介面（contentToPlainText / compact）維持不變，僅重構資料流
- [ ] 非溢出 + 含影像：transcript 原樣返回，未執行壓縮，日誌記錄跳過決策
- [ ] 溢出 + 含影像：壓縮發生，但保留段中的 image parts 原樣存在；被摘要舊段降為純文字佔位
- [ ] 無影像情境的既有壓縮行為完全不變（既有 smoke 維持綠）
- [ ] Smoke 以注入假 deps 驗證上述三種情境（沿既有 governor 注入式 smoke 慣例 import 出貨模組）
- [ ] Plain-browser 降級路徑行為一致
