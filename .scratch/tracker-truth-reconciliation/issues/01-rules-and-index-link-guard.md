# 01 — `resolved` 定義入冊 + INDEX 死連結 drift guard

**What to build:** 兩條長效機制的第一條落地。（a）`docs/agents/triage-labels.md` 補上 `resolved` 的證據定義：Status 可翻 resolved，唯當其引用的 smoke 檔在 gate 上且綠，或該票本質為非程式碼決議（ADR accepted、維護者裁決）並留下決議連結；同處補上 DEV_STATE 於 effort 收口時更新的紀律。（b）恰好一支新 drift guard：解析 `.scratch/INDEX.md` 的相對路徑引用，逐一驗存在（檔案與目錄皆驗），任一不存在即失敗並列出完整路徑；無豁免清單；掛進 `npm run smoke`。

**Blocked by:** None.

Status: resolved

## Acceptance criteria

- [ ] `docs/agents/triage-labels.md` 有 `resolved` 的證據定義與 DEV_STATE 更新紀律。
- [ ] 新 guard 檔案存在（`app/scripts/smoke-tracker-index-links.mts`）且掛進 `npm run smoke`。
- [ ] fixture 自測：含不存在相對路徑的索引 → 失敗且訊息列出該路徑。
- [ ] fixture 自測：全部存在 → 通過。
- [ ] 引用目錄（非僅檔案）也驗存在。
- [ ] 對真實 `.scratch/INDEX.md` 執行為綠（對帳後不應有死路徑）。

## Comments

**2026-08-26 — resolved。**

- 規則落地：`docs/agents/triage-labels.md` 新增「`resolved` 的證據定義（2026-08-26 起）」節——gate smoke 綠或決議文件連結，二擇一；附 DEV_STATE effort 收口更新紀律。
- Guard 落地：`app/scripts/smoke-tracker-index-links.mts`，已掛 `npm run smoke` 主鏈（`smoke.mjs` 之後）。fixture 自測五條全綠：說謊輸入紅且訊息列出路徑、誠實輸入綠、目錄引用也驗、外部連結／anchor 不算路徑、同路徑去重。
- 對帳當下對真實 INDEX.md 首跑即紅——抓出全部四條死連結（`subagents-paid-beta/spec.md` 等），示範價值成立；INDEX 改寫後轉綠（exit 0）。
