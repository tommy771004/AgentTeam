# 07 — Legacy raw-secret contract removal

**What to build:** 完成 credential expand–contract 的 contract 階段，刪除 flat settings 中所有 raw integration secret paths，使 main-process vault 成為唯一 production authority。

**Blocked by:** 05 — Telegram／Webhook vault migration；06 — Custom-tool vault migration。

**Status:** claimed

- [ ] Flat settings schema、defaults、merge、local persistence、IPC projection 與 bundle import/export 不再接受或回傳 raw integration credentials。
- [ ] Legacy data 只可進入 idempotent migration ingress，不能重新被 renderer hydration 復活。
- [ ] Deletion/ownership guard 阻止新增 renderer raw-token field、getter 或 legacy disk fallback。
- [ ] Full credential qualification 覆蓋 migration、restart、runtime use、rotate、clear、redaction 與 safe-storage fail-closed。
- [ ] Security baseline 所宣告的 main-only boundary 與 shipped behavior 一致。
