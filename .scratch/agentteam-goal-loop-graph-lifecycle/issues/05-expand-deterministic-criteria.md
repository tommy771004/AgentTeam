# 05 — 擴充 deterministic criteria

**What to build:** 讓 build、test、artifact schema 與 historical review requirements 能由 Host 以固定 registry 與 revision-bound evidence 驗證。

**Blocked by:** 04 — Acceptance Gate 首條完整路徑.

**Status:** ready-for-agent

- [ ] Registered command 與 test suite 只能引用 Host registry，不能注入自由 shell。
- [ ] JSON schema／artifact criterion 驗證 machine-consumed output contract。
- [ ] Review verification 綁定 immutable snapshot revision，不以 live working tree 補位。
- [ ] Failed criterion 具 reason、evidence refs 與 retryability facts。

