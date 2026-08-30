# 20 — Adaptive run status canonical projection

**What to build:** 任務狀態介面只投影 frozen runner capability、Host lifecycle、Working State 與 bounded activity；live、replay、archive 與 reload 對同一 run 顯示一致狀態。

**Blocked by:** 05 — Finalization claim retry、release 與 drain；07 — External CLI durable lifecycle contract integration；19 — OpenDesign／SubDesign provider lifecycle bridge；adaptive-agent-run-status-surface #01

**Status:** 可交給代理

- [ ] status projection 不從 objective、instruction、context 或文案關鍵字推測 lifecycle
- [ ] builtin 與 external runner 顯示各自真實 capability、waiting、terminal、finalization與delivery state
- [ ] live events、Turn Record replay、archive與reattach使用同一純 projection contract
- [ ] stale、gap、missing與unsupported狀態誠實呈現，不以舊 renderer cache覆寫Host truth
- [ ] desktop/narrow layout、keyboard/focus、overflow與reduced-motion通過實際 UI 驗證，重要內容預設可見
