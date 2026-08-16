# 06 — DoD 建立時可見可編輯

**What to build:** 當任務被判定為 Goal-based（Auto 判定或使用者釘選 Goal）時，使用者在按下送出之前，就能在 composer 上方看到一張自動解析出的 DoD（驗收標準）卡：卡上一句話說明為什麼會出現（例如「Auto 判定為 Goal-based」），DoD 內容可直接編輯，也可以略過。使用者編輯過的 DoD 會跟著這次送出進入 run，成為這次任務真正的驗收標準；沒編輯就完全沿用原本的自動解析結果、行為與現在一模一樣。Turn-based 的輕量對話不會跳出這張卡。

**Blocked by:** 03

**Status:** resolved

- [x] Goal-based（auto 判定或釘選）時卡片出現；Turn-based 不出現
- [x] 卡片顯示一句話原因；DoD 可編輯、可略過
- [x] 使用者編輯的 DoD 隨這次送出生效，成為 run 的驗收標準
- [x] 未編輯時行為與現況完全相同（沿用自動解析），loop 判定不受使用者 DoD 影響
- [x] smoke（純邏輯）：ingress snapshot 帶使用者 DoD 與缺省回退兩種情況
- [x] 元件測試：卡片出現條件、編輯同步、略過

## Answer

新增 `agent/dodPreview`（純）：`previewDod` 只讀 parser 既有判定，Goal-based 才回傳，附一句話原因（auto 判定／已釘選兩種）；`resolveUserDefinitionOfDone` 只在「真的改過」時回傳文字（改回原樣、只差空白、清空、非 Goal 一律 undefined）。`RuntimeOverrides.userDefinitionOfDone` 於 engine 在分類與 LLM 精煉「之後」套用，且只覆寫 DoD 文本；非 Goal-based 時記 WARN 並忽略，不影響 loop 判定、步驟或迭代預算。`DodPreviewCard` 可編輯、可略過，送出後重置。11 個元件測試 + 3 組 smoke。
