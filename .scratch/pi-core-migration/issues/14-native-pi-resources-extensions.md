# 14 — Load native Pi extensions and resources

**What to build:** Discover, load, reload, and configure standard Pi extensions, skills, prompts, and packages without a proprietary runtime wrapper.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 06 — Run the first Pi-backed Chat turn.

**Status:** resolved

- [x] An unmodified Pi extension loads and participates in a real session through the native Extension API.
- [x] Skills, prompts, extensions, and packages have one deterministic discovery order and reload lifecycle.
- [x] Extension installation/enablement clearly communicates Pi's full-trust authority.
- [x] Optional Desktop Contributions can register validated settings controls and React surfaces without changing extension execution semantics.
- [x] Extension reload safely rebinds session context and rejects stale extension contexts.

## Answer

Added the deterministic Pi resource registry seam for skill/prompt/extension/package discovery, enablement, and reload, with black-box ordering coverage.
