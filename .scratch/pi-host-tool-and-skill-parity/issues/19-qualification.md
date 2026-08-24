# 19 — 完整 qualification

**What to build:** 一份可重跑的驗收，證明這個 effort 承諾的事情在出貨路徑上成立：設定裡列的工具就是叫得動的工具、技能寫了就生效、progressive disclosure 仍然省得到 context、核准與出站閘門覆蓋整份目錄。

比照 `scripts/smoke-record-fidelity-qualification.mts` 的 effort 級 qualification 形狀。

**Blocked by:** 01–18

**Status:** 可交給代理

- [x] 單一接縫驅動一條完整路徑：initialize → 目錄投影 → capability load → 技能可見 → 工具執行 → Turn Record 可回讀
- [x] 斷言目錄裡每一個宣稱可用的工具都真的叫得動（沒有第二份幽靈清單）
- [x] 斷言核准、Outbound Data Gate、Restricted Project View 覆蓋 extension tools 與 builtin 一致
- [x] 斷言技能在系統提示中可見、body 依 location 讀得到、archived 不出現
- [x] 斷言 ADR-0027 被移除的工具名稱已不存在於任何目錄
- [x] 掛進 `npm run smoke`，失敗即 fail-closed（dist* 不得打包）
