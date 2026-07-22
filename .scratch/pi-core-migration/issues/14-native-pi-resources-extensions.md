# 14 — Load native Pi extensions and resources

**What to build:** Discover, load, reload, and configure standard Pi extensions, skills, prompts, and packages without a proprietary runtime wrapper.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 06 — Run the first Pi-backed Chat turn.

**Status:** 可交給代理

- [ ] An unmodified Pi extension loads and participates in a real session through the native Extension API.
- [ ] Skills, prompts, extensions, and packages have one deterministic discovery order and reload lifecycle.
- [ ] Extension installation/enablement clearly communicates Pi's full-trust authority.
- [ ] Optional Desktop Contributions can register validated settings controls and React surfaces without changing extension execution semantics.
- [ ] Extension reload safely rebinds session context and rejects stale extension contexts.
