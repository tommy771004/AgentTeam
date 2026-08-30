# 07 — Queue 單一權威收縮與 Release Qualification

Spec: `../spec.md`

**What to build:** 完成 follow-up 架構收縮與交付驗證：Builtin Pi same-session follow-ups 只由 Pi Host 接受、排序、恢復與釋放，renderer queue 不再成為第二權威；External CLI 與 plain-browser compatibility 保留清楚、誠實且有界的 fallback。最終 composer 在 desktop 與窄版都能顯示可操作的 pending cards、獨立 send/stop controls 及正確 runner 能力，並由實際 build、smoke 與 packaged after-build gate 證明可發布。

**Blocked by:** 02 — Builtin Pi same-turn Steer; 03 — Host-owned 同 Pi Session FIFO Queue; 04 — Queue 卡片編輯、刪除與重新排序; 05 — Steer 競態與拒絕恢復; 06 — Follow-up 重啟恢復與投影去重.

**Status:** 可交給代理

- [ ] Builtin Pi follow-up 不再 dual-write renderer queue 與 Host queue；Host 是 acceptance、order、mutation、recovery 與 release 的唯一 authority
- [ ] Renderer 的遺留 queue 僅保留明確 scoped 的 plain-browser／non-Host compatibility，不能投影 Host-accepted 或 true-steer claims
- [ ] External CLI 只顯示 Queue 與明確「中止並接手」，其 process outcome 不冒充 Builtin Pi same-turn steer 或 DoD
- [ ] 所有 queue release 仍經唯一 `runTask` ingress 與 unique finalization，沒有 UI direct dispatch、Host direct session start 或第二 settlement owner
- [ ] Composer desktop／窄版顯示 bounded instruction previews、action/state、合法 controls 與獨立 send/stop，內容不裁切且不產生 horizontal overflow
- [ ] Keyboard、focus、screen-reader announcements、expanded long content、reduced motion 與 hit targets 通過 rendered accessibility checks
- [ ] Drift guards 鎖定 no dual authority、no abort-as-steer、External CLI capability honesty、terminal-only release 與 feature-detected bridge
- [ ] Relevant ADR／domain／busy-policy 文件與實際行為一致，舊有把 steer 定義為 abort-and-replace 的敘事已移除或標為 historical
- [ ] Focused follow-up suite、`npm run build`、`npx oxlint src`、完整 `npm run smoke` 與 Electron bridge 變更所需 packaged after-build smoke 全綠
- [ ] Qualification evidence 記錄真 Host steer、三筆 FIFO、restart、External CLI／plain-browser fallback、desktop／narrow rendered UI，所有 acceptance criteria 有一 hop 可查證證據
