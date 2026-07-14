# OpenDesign catalog is the single source of truth for installable design content

**Status**: accepted

SubDesign had two divergent paths for vendor-derived content: templates existed as both a hardcoded 28-item `SUBDESIGN_TEMPLATES` array and dynamic OpenDesign catalog records, merged and deduped at render time; separately, the OpenDesign catalog's `kind: 'design-system'` records had a half-built install path (`copyOpenDesignVendorPack` in `electron/main.ts`) that no UI ever reached, leaving ~150 vendored design systems installable on the backend but invisible in the product.

We're treating the OpenDesign catalog (`agent/openDesign/catalog.ts`) as the single authoritative index for all installable vendor content — templates, skills, and design systems alike. The hardcoded `SUBDESIGN_TEMPLATES` array is retired (its 28 curated entries ported into first-party catalog entries), and the SubDesign picker is wired to surface `kind: 'design-system'` catalog records through the existing install path, so a **Design System Pack** becomes a project-owned **Design System** (`DESIGN.md` under `.subagents/subdesign/design-systems/<id>/`) the same way picking a template seeds a project-owned artifact.

Two sources of truth for "what content is available" had already drifted once (the design-system install path was built and then never connected). A single catalog with an explicit, uniform install step keeps vendor content read-only/inert until a user deliberately brings it into a project — consistent with how artifacts already work.

**Considered and rejected**:
- Keeping the template dual-source merge permanently as a build-resilience fallback (in case `app/public/open-design` is stripped or fails to index) — rejected; that risk doesn't justify permanently maintaining two parallel lists that can silently drift apart.
- Leaving design-system packs browse-only forever — rejected; it strands the majority of vendored content (150 design systems) as read-only reference material with no way to actually use it.

## Implementation status

- [Ｘ] 已實作並驗證：OpenDesign catalog 成為 template / skill / design-system 的唯一索引；移除 picker 對 hardcoded template array 的依賴；Design System Pack 會經由既有安裝流程複製成 project-owned `DESIGN.md`，並以 inventory / smoke / build 驗證來源與安全邊界。
