# 17 — Headless lifecycle boundary

**What to build:** 既有 headless development/evaluation seam 使用明確 source、unattended 與 no-DOM contract 進入同一 coordinator，且在缺 Electron bridge 時誠實降級，不成為第二 runtime。

**Blocked by:** 05 — Finalization claim retry、release 與 drain；harness-gap-closure #10 evidence

**Status:** 可交給代理

- [ ] headless request 明確使用 headless source kind、unattended policy 與 bounded admission snapshot
- [ ] Node path 不 import DOM、renderer store 或 UI-only module，Host bridge 能力以 feature detection fail closed
- [ ] builtin/external runner 維持各自 capability honesty，不以 headless exit code宣稱 DoD
- [ ] restart、cancel、pending delivery 與 missing Host 的結果可重建或明確 unsupported
- [ ] 既有 implementation 與 tracker evidence 對帳，不新增第二 headless ingress
