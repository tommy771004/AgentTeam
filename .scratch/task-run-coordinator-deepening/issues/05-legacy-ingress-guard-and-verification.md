# 05 — 移除 legacy lifecycle ownership 並加上 ingress guard

**What to build:** 完成 migration 後，legacy export 仍可相容舊整合，但不再擁有任何 Task run lifecycle；新的 direct legacy dispatch 會被 source contract 擋下，文件與完整品質 gates 共同證明 coordinator 是唯一入口。

**Blocked by:** 01 — 建立 coordinator-owned Task run contract；02 — 統一 denial、exception、cancel 的唯一 finalization；03 — 讓 external CLI 共用 coordinator lifecycle；04 — 收斂 queue、attachments 與 background delegate

**Status:** 已實作並驗證；待使用者審閱

- [ ] `runExternalObjective` 只保留 compatibility adapter 或 runner-specific implementation，不再自行 reserve、bind、finalize、release 或 drain。
- [ ] queue、UI、scheduler、webhook、Telegram、delegate、retry 等 entry points 均使用 canonical `runTask` seam。
- [ ] source-contract smoke 能偵測新 code 繞過 coordinator 的 direct lifecycle entry。
- [ ] `AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、ADR-0003 與 task lifecycle plan 對 ownership 描述一致。
- [ ] `npm run smoke`、`npm run build`、`npx oxlint src` 全部通過，且 review 可針對本次 diff 執行 Standards/Spec 雙軸檢查。
