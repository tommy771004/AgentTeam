# 16 — External CLI provider parser prefactor

**What to build:** 將 external CLI 的 provider-specific line parsing 拆成 bounded parsers，使 diagnostics、activity 與 terminal outcomes 可獨立驗證，而不改變 external runner capability truth。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 已完成

- [x] Provider parsers 對 partial lines、ANSI/control sequences、JSON events、stderr/stdout interleave 與 process exit 有明確 bounded contract。
- [x] Common runner lifecycle 不再包含各 provider 的大型 conditional parser，但 cancellation、timeout 與 capacity release 行為不變。
- [x] 真實或 captured provider fixtures 驗證 activity、diagnostic、approval/auth/input 與 terminal projection。
- [x] External CLI success 仍不被升級為 builtin Parse／DoD／iterate guarantees。
- [x] Complexity 實質下降，沒有新增 renderer-owned runner 或 terminal scraping authority。

## Implementation evidence

- `externalCliProviderParsers.ts` separates waiting/auth, narrative/result, Codex item/file, and Codex lifecycle parsing into bounded functions; the common runner now delegates provider JSON instead of owning its 219-line conditional block.
- Stream buffering is channel-specific, so partial stdout and stderr lines cannot corrupt each other; ANSI/control stripping and bounded diagnostic/session fields remain enforced.
- Captured Grok, Gemini, Claude, Cursor, and Codex fixtures pass, alongside the 24-case durable supervisor harness, orchestration/record smokes, build, and complexity gate.
- Runner capability declarations were unchanged: external success still does not claim builtin Parse, DoD, or iterate guarantees.
