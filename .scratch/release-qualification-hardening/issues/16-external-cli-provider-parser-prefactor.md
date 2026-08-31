# 16 — External CLI provider parser prefactor

**What to build:** 將 external CLI 的 provider-specific line parsing 拆成 bounded parsers，使 diagnostics、activity 與 terminal outcomes 可獨立驗證，而不改變 external runner capability truth。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 可交給代理

- [ ] Provider parsers 對 partial lines、ANSI/control sequences、JSON events、stderr/stdout interleave 與 process exit 有明確 bounded contract。
- [ ] Common runner lifecycle 不再包含各 provider 的大型 conditional parser，但 cancellation、timeout 與 capacity release 行為不變。
- [ ] 真實或 captured provider fixtures 驗證 activity、diagnostic、approval/auth/input 與 terminal projection。
- [ ] External CLI success 仍不被升級為 builtin Parse／DoD／iterate guarantees。
- [ ] Complexity 實質下降，沒有新增 renderer-owned runner 或 terminal scraping authority。
