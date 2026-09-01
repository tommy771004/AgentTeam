# 18 — Smoke ownership 與 source-text guard migration

**What to build:** 整理 smoke topology，保留必要的 architecture deletion/ownership guards，並把只依賴 implementation text shape 的斷言遷移到 shipped behavior seams。

**Blocked by:** 14 — Task run admission／finalization prefactor；15 — Pi Host turn routing prefactor；16 — External CLI provider parser prefactor；17 — Startup recovery phase prefactor。

**Status:** 已完成

- [x] 現有 guards 被分類為 deletion/ownership、public API contract 或 accidental implementation-shape assertions，且各有 owning qualification。
- [x] Accidental text-shape assertions 改由 shipped module 或最高可用 runtime seam 驗證外部行為。
- [x] Essential single-ingress、Pi ownership、protocol domain 與 retired-path deletion guards 保留並重指真 owner。
- [x] CI stable、full smoke、release E2E 與 platform qualification 的責任清單可一 hop 查核，沒有同一 heavy test 的無意重複鏈。
- [x] 重構 source layout 不再因無關文字位置失敗，但刪除 coverage 或新增第二 authority 仍必紅。

## Implementation evidence

- `qualification-ownership.mts` classifies deletion/ownership, public-API, and runtime-behavior qualifications and maps each contract one hop to its owner.
- Behavior smokes for admission, turn routing, startup phases, and lazy chunks no longer inspect incidental source layout. Central `check-pi-contract` retains only intentional deletion/ownership checks and now points to the four new production owners plus the Turn protocol domain.
- The topology smoke expands every runtime path (cycle-protecting only the active stack, never globally deduplicating shared children), so duplicate heavy Electron/subprocess execution under `smoke` or `check` is visible; a synthetic diamond-chain fixture proves the detector itself. The orphan-test guard proves every automated qualification is gated.
- `npm run check:pi-contract` and all migrated shipped-module/runtime smokes pass.
