# 03 — Shell and conversation visual language

Status: resolved
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Unify the shell navigation rows and task conversation rows through one restrained visual language while preserving their separate owners. Align row height, icon slot, typography, active tone, hover tone, focus treatment, gutters and collapsed icon centering. A small presentation-only shared row primitive is allowed; routing, collapse and thread actions must not move into it.

Reuse the existing icon system and design tokens. Remove or reduce material effects that create radial halos, cut-off glow, hard-edged shadow boxes, repeated pills or decorative hairlines. Do not use gliding highlights, translate/scale hover movement or opacity-gated entrance content. Preserve the macOS traffic-light drag-safe region, Pi Host status, live-run entry and shell route behavior.

## Acceptance criteria

- [x] Shell route rows and conversation rows share deliberate dimensions and state treatment
- [x] Shell remains the only owner of global route collapse
- [x] Pi Host status, live-run entry and macOS drag-safe region remain intact
- [x] Existing icons and tokens are reused; no new icon or glide dependency is added
- [x] Hover and active controls do not translate or scale
- [x] Required labels and controls are visible by default
- [x] Reduced-motion mode removes non-essential transition motion
- [x] Expanded and collapsed icons are mathematically and optically centered
- [x] Labels and focus rings clear all clipped or fixed-height edges
- [x] Material effects have no cut-off glow, radial halo or traceable hard shadow box
- [x] Text and active states meet readable contrast
- [x] `npm run build` and `npx oxlint src` pass

## Comments

Resolved across `2988240` and `f5a589b`. The final anti-slop pass removed the decorative sidebar hairline and retained only restrained tonal material, stable hover states and visible-by-default content. Full evidence: [`../qualification.md`](../qualification.md).

## Blocked by

None.
